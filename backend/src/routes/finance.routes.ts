import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  accounts,
  addAuditLog,
  categories,
  creditCards,
  investments,
  runInTransaction,
  transactions,
} from '../db/database';
import { decryptField, decryptNumber, encryptField } from '../crypto/envelope';
import { requireAuth, requireRole, requireUnlockedVault } from '../middlewares/security';

const router = Router();

// Todas as rotas financeiras exigem Perfil TITULAR e Cofre Desbloqueado (DEK em memória)
router.use(requireAuth, requireRole('TITULAR'), requireUnlockedVault);

function addMonthsToDate(dateStr: string, monthsToAdd: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetYear = y + Math.floor((m - 1 + monthsToAdd) / 12);
  const targetMonth = ((m - 1 + monthsToAdd) % 12) + 1;
  const maxDayInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const safeDay = Math.min(d, maxDayInMonth);
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

/** Data de hoje (YYYY-MM-DD) no fuso do Brasil, independente do fuso do servidor (nuvem roda em UTC). */
function todayLocalISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Calcula a data de vencimento da fatura em que uma compra no cartão vai cair.
 * Compra antes do dia de fechamento entra na fatura do mês; no dia do fechamento ou depois, vai para a próxima.
 */
function cardInvoiceDueDate(purchaseDate: string, closingDay: number, dueDay: number): string {
  const [y, m, d] = purchaseDate.split('-').map(Number);
  const closesNextMonth = d >= closingDay ? 1 : 0;
  const dueAfterClosing = dueDay <= closingDay ? 1 : 0;
  const base = `${y}-${String(m).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
  return addMonthsToDate(base, closesNextMonth + dueAfterClosing);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/finance/overview?month=YYYY-MM
 * Descriptografa em memória todos os saldos, contas, cartões, investimentos e lançamentos do mês.
 */
router.get('/overview', (req: Request, res: Response) => {
  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;
  const rawMonth = req.query.month as string | undefined;
  const monthParam = rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : todayLocalISO().slice(0, 7);

  // 1. Contas Bancárias descriptografadas
  const decryptedAccounts = accounts.list(userId).map((a) => ({
    id: a.id,
    name: decryptField(a.name_enc, dekHex),
    institution: decryptField(a.institution_enc, dekHex),
    type: a.type,
    balance: decryptNumber(a.balance_enc, dekHex),
    updatedAt: a.updated_at,
  }));

  // 2. Categorias
  const userCategories = categories.list(userId);
  const categoryMap = new Map(userCategories.map((c) => [c.id, c]));
  const accountMap = new Map(decryptedAccounts.map((a) => [a.id, a]));

  // 3. Todas as transações descriptografadas do titular
  const allTransactions = transactions.list(userId).map((t) => {
    const cat = t.category_id ? categoryMap.get(t.category_id) : undefined;
    const acc = t.account_id ? accountMap.get(t.account_id) : undefined;
    return {
      id: t.id,
      accountId: t.account_id,
      accountName: acc?.name || null,
      creditCardId: t.credit_card_id,
      categoryId: t.category_id,
      categoryName: cat?.name || 'Geral',
      categoryColor: cat?.color || '#64748b',
      installmentGroupId: t.installment_group_id,
      type: t.type,
      description: decryptField(t.description_enc, dekHex),
      amount: decryptNumber(t.amount_enc, dekHex),
      competenceDate: t.competence_date,
      dueDate: t.due_date,
      status: t.status,
      isRecurring: t.is_recurring,
      installmentNumber: t.installment_number,
      totalInstallments: t.total_installments,
    };
  });

  // 4. Cartões de Crédito descriptografados + fatura e extrato por cartão
  const decryptedCards = creditCards.list(userId).map((c) => {
    const cardName = decryptField(c.name_enc, dekHex);
    const limit = decryptNumber(c.limit_enc, dekHex);
    const allCardTransactions = allTransactions
      .filter((t) => t.creditCardId === c.id)
      .map((t) => ({ ...t, creditCardName: cardName }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const cardMonthTransactions = allCardTransactions.filter((t) =>
      t.dueDate.startsWith(monthParam)
    );
    const monthInvoice = cardMonthTransactions.reduce((acc, item) => acc + item.amount, 0);
    const totalCommitted = allCardTransactions
      .filter((t) => t.status === 'PENDING')
      .reduce((acc, item) => acc + item.amount, 0);

    return {
      id: c.id,
      accountId: c.account_id,
      name: cardName,
      limit,
      monthInvoice,
      totalCommitted,
      availableLimit: Math.max(0, limit - totalCommitted),
      closingDay: c.closing_day,
      dueDay: c.due_day,
      monthTransactions: cardMonthTransactions,
      allCardTransactions,
    };
  });

  const cardMap = new Map(decryptedCards.map((c) => [c.id, c]));

  // 5. Filtra transações do mês selecionado (YYYY-MM)
  const monthTransactions = allTransactions
    .filter((t) => t.dueDate.startsWith(monthParam))
    .map((t) => ({
      ...t,
      creditCardName: t.creditCardId ? cardMap.get(t.creditCardId)?.name || null : null,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // 6. Investimentos e Patrimônio descriptografados
  const decryptedInvestments = investments.list(userId).map((i) => {
    const principalAmount = decryptNumber(i.principal_amount_enc, dekHex);
    const currentValue = decryptNumber(i.current_value_enc, dekHex);
    const monthlyYield = decryptNumber(i.monthly_yield_enc, dekHex);
    return {
      id: i.id,
      name: decryptField(i.name_enc, dekHex),
      institution: decryptField(i.institution_enc, dekHex),
      category: i.category,
      principalAmount,
      currentValue,
      monthlyYield,
      profitAmount: currentValue - principalAmount,
      updatedAt: i.updated_at,
    };
  });

  // 7. Alertas de Contas a Vencer (vencidas ou vencendo nos próximos 7 dias)
  const todayStr = todayLocalISO();
  const in7Days = addDaysToDate(todayStr, 7);

  const upcomingAlerts = allTransactions
    .filter((t) => t.type === 'EXPENSE' && t.status === 'PENDING' && t.dueDate <= in7Days)
    .map((t) => ({
      ...t,
      creditCardName: t.creditCardId ? cardMap.get(t.creditCardId)?.name || null : null,
      isOverdue: t.dueDate < todayStr,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // 8. Totais Consolidados
  const totalAccountsBalance = decryptedAccounts.reduce((sum, a) => sum + a.balance, 0);
  const totalInvestmentsValue = decryptedInvestments.reduce((sum, i) => sum + i.currentValue, 0);
  const totalMonthlyYield =
    totalInvestmentsValue > 0
      ? decryptedInvestments.reduce((sum, i) => sum + i.currentValue * i.monthlyYield, 0) /
        totalInvestmentsValue
      : 0;

  const monthIncome = monthTransactions
    .filter((t) => t.type === 'INCOME')
    .reduce((sum, t) => sum + t.amount, 0);
  const monthExpensePaid = monthTransactions
    .filter((t) => t.type === 'EXPENSE' && t.status === 'PAID')
    .reduce((sum, t) => sum + t.amount, 0);
  const monthExpensePending = monthTransactions
    .filter((t) => t.type === 'EXPENSE' && t.status === 'PENDING')
    .reduce((sum, t) => sum + t.amount, 0);
  const monthExpenseTotal = monthExpensePaid + monthExpensePending;

  // 9. Comparativo com o Mês Anterior
  const [selY, selM] = monthParam.split('-').map(Number);
  const prevDateObj = new Date(selY, selM - 2, 1);
  const prevMonthParam = `${prevDateObj.getFullYear()}-${String(prevDateObj.getMonth() + 1).padStart(2, '0')}`;
  const prevMonthTxs = allTransactions.filter((t) => t.dueDate.startsWith(prevMonthParam));
  const prevMonthIncome = prevMonthTxs
    .filter((t) => t.type === 'INCOME')
    .reduce((sum, t) => sum + t.amount, 0);
  const prevMonthExpenseTotal = prevMonthTxs
    .filter((t) => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + t.amount, 0);

  const expenseDiffAmount = Number((monthExpenseTotal - prevMonthExpenseTotal).toFixed(2));
  const expenseDiffPct =
    prevMonthExpenseTotal > 0
      ? Number((((monthExpenseTotal - prevMonthExpenseTotal) / prevMonthExpenseTotal) * 100).toFixed(1))
      : null;

  const incomeDiffAmount = Number((monthIncome - prevMonthIncome).toFixed(2));
  const incomeDiffPct =
    prevMonthIncome > 0
      ? Number((((monthIncome - prevMonthIncome) / prevMonthIncome) * 100).toFixed(1))
      : null;

  res.json({
    month: monthParam,
    summary: {
      totalAccountsBalance,
      totalInvestmentsValue,
      totalPatrimony: totalAccountsBalance + totalInvestmentsValue,
      totalMonthlyYield,
      monthIncome,
      monthExpensePaid,
      monthExpensePending,
      monthExpenseTotal,
      monthNetBalance: monthIncome - monthExpenseTotal,
      prevMonth: prevMonthParam,
      prevMonthIncome,
      prevMonthExpenseTotal,
      expenseDiffAmount,
      expenseDiffPct,
      incomeDiffAmount,
      incomeDiffPct,
    },
    accounts: decryptedAccounts,
    creditCards: decryptedCards,
    investments: decryptedInvestments,
    categories: userCategories,
    transactions: monthTransactions,
    upcomingAlerts,
  });
});

/**
 * POST /api/finance/accounts
 */
router.post('/accounts', (req: Request, res: Response) => {
  const { name, institution, type, balance } = req.body as {
    name?: string;
    institution?: string;
    type?: 'CHECKING' | 'SAVINGS' | 'CASH';
    balance?: number;
  };
  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;

  if (!name || !institution) {
    res.status(400).json({ error: 'Informe o nome da conta e o banco/instituição.' });
    return;
  }

  const id = crypto.randomUUID();
  accounts.insert({
    id,
    user_id: userId,
    name_enc: encryptField(name.trim(), dekHex),
    institution_enc: encryptField(institution.trim(), dekHex),
    type: type || 'CHECKING',
    balance_enc: encryptField(Number(balance) || 0, dekHex),
    updated_at: new Date().toISOString(),
  });

  res.status(201).json({ message: 'Conta adicionada com criptografia AES-256-GCM.', id });
});

/**
 * PUT /api/finance/accounts/:id
 */
router.put('/accounts/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, institution, balance } = req.body as {
    name?: string;
    institution?: string;
    balance?: number;
  };
  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;

  const acc = accounts.get(id, userId);
  if (!acc) {
    res.status(404).json({ error: 'Conta não encontrada.' });
    return;
  }

  accounts.update(id, userId, {
    name_enc: name ? encryptField(name.trim(), dekHex) : undefined,
    institution_enc: institution ? encryptField(institution.trim(), dekHex) : undefined,
    balance_enc: balance !== undefined ? encryptField(Number(balance) || 0, dekHex) : undefined,
    updated_at: new Date().toISOString(),
  });

  res.json({ message: 'Conta atualizada com sucesso.' });
});

/**
 * DELETE /api/finance/accounts/:id
 */
router.delete('/accounts/:id', (req: Request, res: Response) => {
  accounts.remove(req.params.id, req.userSession!.userId);
  res.json({ message: 'Conta removida.' });
});

/**
 * POST /api/finance/credit-cards
 */
router.post('/credit-cards', (req: Request, res: Response) => {
  const { name, limit, closingDay, dueDay, accountId } = req.body as {
    name?: string;
    limit?: number;
    closingDay?: number;
    dueDay?: number;
    accountId?: string;
  };
  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;

  if (!name || limit === undefined) {
    res.status(400).json({ error: 'Informe o nome do cartão e o limite.' });
    return;
  }

  creditCards.insert({
    id: crypto.randomUUID(),
    user_id: userId,
    account_id: accountId || null,
    name_enc: encryptField(name.trim(), dekHex),
    limit_enc: encryptField(Number(limit) || 0, dekHex),
    closing_day: Math.min(31, Math.max(1, Number(closingDay) || 5)),
    due_day: Math.min(31, Math.max(1, Number(dueDay) || 12)),
    created_at: new Date().toISOString(),
  });

  res.status(201).json({ message: 'Cartão cadastrado com sucesso.' });
});

/**
 * PUT /api/finance/credit-cards/:id
 * Atualiza nome, limite, dia de fechamento e dia de vencimento do Cartão de Crédito.
 */
router.put('/credit-cards/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, limit, closingDay, dueDay } = req.body as {
    name?: string;
    limit?: number;
    closingDay?: number;
    dueDay?: number;
  };
  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;

  const card = creditCards.get(id, userId);
  if (!card) {
    res.status(404).json({ error: 'Cartão não encontrado.' });
    return;
  }

  creditCards.update(id, userId, {
    name_enc: name ? encryptField(name.trim(), dekHex) : undefined,
    limit_enc: limit !== undefined ? encryptField(Number(limit) || 0, dekHex) : undefined,
    closing_day:
      closingDay !== undefined ? Math.min(31, Math.max(1, Number(closingDay) || 5)) : undefined,
    due_day: dueDay !== undefined ? Math.min(31, Math.max(1, Number(dueDay) || 12)) : undefined,
  });

  res.json({ message: 'Dados do cartão atualizados com sucesso!' });
});

/**
 * DELETE /api/finance/credit-cards/:id
 */
router.delete('/credit-cards/:id', (req: Request, res: Response) => {
  const userId = req.userSession!.userId;
  // Remove também as compras/parcelas do cartão, para não ficarem como despesas "soltas" sem cartão
  runInTransaction(() => {
    transactions.removeByCard(req.params.id, userId);
    creditCards.remove(req.params.id, userId);
  });
  res.json({ message: 'Cartão e suas compras removidos.' });
});

/**
 * POST /api/finance/credit-cards/:id/pay-invoice
 * Quita (marca como PAGO) todas as compras pendentes da fatura do cartão no mês selecionado,
 * descontando opcionalmente o valor total da conta bancária escolhida.
 */
router.post('/credit-cards/:id/pay-invoice', (req: Request, res: Response) => {
  const { id } = req.params;
  const { month, accountId } = req.body as {
    month?: string;
    accountId?: string | null;
  };
  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;

  const card = creditCards.get(id, userId);
  if (!card) {
    res.status(404).json({ error: 'Cartão de crédito não encontrado.' });
    return;
  }

  const targetMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : todayLocalISO().slice(0, 7);
  const pendingCardTxs = transactions
    .list(userId)
    .filter(
      (t) =>
        t.credit_card_id === id &&
        t.status === 'PENDING' &&
        t.due_date.startsWith(targetMonth)
    );

  if (pendingCardTxs.length === 0) {
    res.status(400).json({ error: 'Não há compras pendentes nesta fatura para quitar.' });
    return;
  }

  const totalInvoice = pendingCardTxs.reduce(
    (sum, t) => sum + decryptNumber(t.amount_enc, dekHex),
    0
  );

  runInTransaction(() => {
    for (const item of pendingCardTxs) {
      transactions.setStatus(item.id, userId, 'PAID');
    }

    if (accountId) {
      const acc = accounts.get(accountId, userId);
      if (acc) {
        const curBal = decryptNumber(acc.balance_enc, dekHex);
        accounts.update(accountId, userId, {
          balance_enc: encryptField(Number((curBal - totalInvoice).toFixed(2)), dekHex),
          updated_at: new Date().toISOString(),
        });
      }
    }
  });

  const cardName = decryptField(card.name_enc, dekHex);
  res.json({
    message: `Fatura do cartão "${cardName}" (${pendingCardTxs.length} item(ns) • R$ ${totalInvoice.toFixed(2).replace('.', ',')}) quitada com sucesso!`,
  });
});

/**
 * POST /api/finance/investments
 */
router.post('/investments', (req: Request, res: Response) => {
  const { name, institution, category, principalAmount, currentValue, monthlyYield } = req.body as {
    name?: string;
    institution?: string;
    category?: 'FIXED_INCOME' | 'SAVINGS' | 'PENSION' | 'PATRIMONY';
    principalAmount?: number;
    currentValue?: number;
    monthlyYield?: number;
  };
  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;

  if (!name || !institution) {
    res.status(400).json({ error: 'Informe o nome da aplicação e a instituição.' });
    return;
  }

  investments.insert({
    id: crypto.randomUUID(),
    user_id: userId,
    name_enc: encryptField(name.trim(), dekHex),
    institution_enc: encryptField(institution.trim(), dekHex),
    category: category || 'FIXED_INCOME',
    principal_amount_enc: encryptField(Number(principalAmount) || 0, dekHex),
    current_value_enc: encryptField(Number(currentValue) || Number(principalAmount) || 0, dekHex),
    monthly_yield_enc: encryptField(Number(monthlyYield) || 0, dekHex),
    updated_at: new Date().toISOString(),
  });

  res.status(201).json({ message: 'Investimento registrado no cofre criptografado.' });
});

/**
 * PUT /api/finance/investments/:id
 */
router.put('/investments/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, institution, category, principalAmount, currentValue, monthlyYield } = req.body as {
    name?: string;
    institution?: string;
    category?: 'FIXED_INCOME' | 'SAVINGS' | 'PENSION' | 'PATRIMONY';
    principalAmount?: number;
    currentValue?: number;
    monthlyYield?: number;
  };
  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;

  const inv = investments.get(id, userId);
  if (!inv) {
    res.status(404).json({ error: 'Investimento não encontrado.' });
    return;
  }

  investments.update(id, userId, {
    name_enc: name ? encryptField(name.trim(), dekHex) : undefined,
    institution_enc: institution ? encryptField(institution.trim(), dekHex) : undefined,
    category: category || undefined,
    principal_amount_enc:
      principalAmount !== undefined ? encryptField(Number(principalAmount) || 0, dekHex) : undefined,
    current_value_enc:
      currentValue !== undefined ? encryptField(Number(currentValue) || 0, dekHex) : undefined,
    monthly_yield_enc:
      monthlyYield !== undefined ? encryptField(Number(monthlyYield) || 0, dekHex) : undefined,
    updated_at: new Date().toISOString(),
  });

  res.json({ message: 'Investimento atualizado com sucesso!' });
});

/**
 * DELETE /api/finance/investments/:id
 */
router.delete('/investments/:id', (req: Request, res: Response) => {
  investments.remove(req.params.id, req.userSession!.userId);
  res.json({ message: 'Investimento removido.' });
});

/**
 * POST /api/finance/transfers
 * Realiza transferência atômica entre Contas Bancárias ou Aporte/Resgate de Investimentos.
 */
router.post('/transfers', (req: Request, res: Response) => {
  const {
    mode,
    fromAccountId,
    toAccountId,
    fromInvestmentId,
    toInvestmentId,
    amount,
  } = req.body as {
    mode?: 'ACCOUNT_TO_ACCOUNT' | 'ACCOUNT_TO_INVESTMENT' | 'INVESTMENT_TO_ACCOUNT';
    fromAccountId?: string;
    toAccountId?: string;
    fromInvestmentId?: string;
    toInvestmentId?: string;
    amount?: number;
  };

  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;
  const val = Math.abs(Number(amount) || 0);

  if (!mode || val <= 0) {
    res.status(400).json({ error: 'Informe um valor válido maior que zero para a operação.' });
    return;
  }

  if (mode === 'ACCOUNT_TO_ACCOUNT') {
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
      res.status(400).json({ error: 'Selecione duas contas diferentes para transferir.' });
      return;
    }
    const sourceAcc = accounts.get(fromAccountId, userId);
    const destAcc = accounts.get(toAccountId, userId);
    if (!sourceAcc || !destAcc) {
      res.status(404).json({ error: 'Conta de origem ou destino não encontrada.' });
      return;
    }

    const sourceName = decryptField(sourceAcc.name_enc, dekHex);
    const destName = decryptField(destAcc.name_enc, dekHex);

    runInTransaction(() => {
      const curSource = decryptNumber(sourceAcc.balance_enc, dekHex);
      const curDest = decryptNumber(destAcc.balance_enc, dekHex);
      accounts.update(fromAccountId, userId, {
        balance_enc: encryptField(Number((curSource - val).toFixed(2)), dekHex),
      });
      accounts.update(toAccountId, userId, {
        balance_enc: encryptField(Number((curDest + val).toFixed(2)), dekHex),
      });
    });

    res.json({
      message: `Transferência de R$ ${val.toFixed(2).replace('.', ',')} de "${sourceName}" para "${destName}" concluída!`,
    });
    return;
  }

  if (mode === 'ACCOUNT_TO_INVESTMENT') {
    if (!fromAccountId || !toInvestmentId) {
      res.status(400).json({ error: 'Selecione a conta de origem e o investimento de destino.' });
      return;
    }
    const sourceAcc = accounts.get(fromAccountId, userId);
    const destInv = investments.get(toInvestmentId, userId);
    if (!sourceAcc || !destInv) {
      res.status(404).json({ error: 'Conta ou investimento não encontrado.' });
      return;
    }

    const sourceName = decryptField(sourceAcc.name_enc, dekHex);
    const invName = decryptField(destInv.name_enc, dekHex);

    runInTransaction(() => {
      const curAccBalance = decryptNumber(sourceAcc.balance_enc, dekHex);
      const curPrincipal = decryptNumber(destInv.principal_amount_enc, dekHex);
      const curValue = decryptNumber(destInv.current_value_enc, dekHex);

      accounts.update(fromAccountId, userId, {
        balance_enc: encryptField(Number((curAccBalance - val).toFixed(2)), dekHex),
      });
      investments.update(toInvestmentId, userId, {
        principal_amount_enc: encryptField(Number((curPrincipal + val).toFixed(2)), dekHex),
        current_value_enc: encryptField(Number((curValue + val).toFixed(2)), dekHex),
        updated_at: new Date().toISOString(),
      });
    });

    res.json({
      message: `Aporte de R$ ${val.toFixed(2).replace('.', ',')} realizado de "${sourceName}" para "${invName}"!`,
    });
    return;
  }

  if (mode === 'INVESTMENT_TO_ACCOUNT') {
    if (!fromInvestmentId || !toAccountId) {
      res.status(400).json({ error: 'Selecione o investimento de origem e a conta de destino.' });
      return;
    }
    const sourceInv = investments.get(fromInvestmentId, userId);
    const destAcc = accounts.get(toAccountId, userId);
    if (!sourceInv || !destAcc) {
      res.status(404).json({ error: 'Investimento ou conta não encontrada.' });
      return;
    }

    const invName = decryptField(sourceInv.name_enc, dekHex);
    const destName = decryptField(destAcc.name_enc, dekHex);

    runInTransaction(() => {
      const curPrincipal = decryptNumber(sourceInv.principal_amount_enc, dekHex);
      const curValue = decryptNumber(sourceInv.current_value_enc, dekHex);
      const curAccBalance = decryptNumber(destAcc.balance_enc, dekHex);

      const nextValue = Math.max(0, Number((curValue - val).toFixed(2)));
      const nextPrincipal = Math.min(nextValue, Math.max(0, Number((curPrincipal - val).toFixed(2))));

      investments.update(fromInvestmentId, userId, {
        principal_amount_enc: encryptField(nextPrincipal, dekHex),
        current_value_enc: encryptField(nextValue, dekHex),
        updated_at: new Date().toISOString(),
      });
      accounts.update(toAccountId, userId, {
        balance_enc: encryptField(Number((curAccBalance + val).toFixed(2)), dekHex),
      });
    });

    res.json({
      message: `Resgate de R$ ${val.toFixed(2).replace('.', ',')} de "${invName}" creditado em "${destName}"!`,
    });
    return;
  }

  res.status(400).json({ error: 'Modalidade de transferência inválida.' });
});

/**
 * POST /api/finance/categories
 * Cria uma categoria manualmente pelo usuário.
 */
router.post('/categories', (req: Request, res: Response) => {
  const { name, type } = req.body as { name?: string; type?: 'INCOME' | 'EXPENSE' };
  const userId = req.userSession!.userId;

  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Digite o nome da categoria.' });
    return;
  }

  const cat = categories.findOrCreate(userId, name.trim(), type || 'EXPENSE');
  res.status(201).json({ message: `Categoria "${cat.name}" salva!`, category: cat });
});

/**
 * DELETE /api/finance/categories/:id
 * Remove uma categoria criada manualmente.
 */
router.delete('/categories/:id', (req: Request, res: Response) => {
  categories.remove(req.params.id, req.userSession!.userId);
  res.json({ message: 'Categoria removida.' });
});

/**
 * POST /api/finance/transactions
 * Registra Receitas, Despesas à vista, Contas Fixas Recorrentes ou Compras Parceladas (1/N a N/N) em transação SQLite atômica.
 */
router.post('/transactions', (req: Request, res: Response) => {
  const {
    type,
    description,
    amount,
    purchaseDate,
    dueDate,
    status,
    accountId,
    creditCardId,
    categoryId,
    categoryName,
    isRecurring,
    repeatMonths,
    totalInstallments,
  } = req.body as {
    type?: 'INCOME' | 'EXPENSE';
    description?: string;
    amount?: number;
    purchaseDate?: string;
    dueDate?: string;
    status?: 'PAID' | 'PENDING';
    accountId?: string | null;
    creditCardId?: string | null;
    categoryId?: string | null;
    categoryName?: string | null;
    isRecurring?: boolean;
    repeatMonths?: number;
    totalInstallments?: number;
  };

  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;

  if (!description || !description.trim() || !amount || Number(amount) <= 0 || !dueDate || !ISO_DATE_RE.test(dueDate)) {
    res.status(400).json({ error: 'Preencha a descrição, um valor válido e a data de vencimento.' });
    return;
  }

  const txType = type === 'INCOME' ? 'INCOME' : 'EXPENSE';

  // Valida que a conta/cartão informados pertencem ao titular
  const card = creditCardId ? creditCards.get(creditCardId, userId) : undefined;
  if (creditCardId && !card) {
    res.status(400).json({ error: 'Cartão de crédito não encontrado.' });
    return;
  }
  if (!creditCardId && accountId && !accounts.get(accountId, userId)) {
    res.status(400).json({ error: 'Conta bancária não encontrada.' });
    return;
  }

  // Se o formulário enviou purchaseDate (Data da Compra) e dueDate (Vencimento da Fatura),
  // respeita exatamente as duas datas informadas sem projetar mais 1 mês em cima.
  const hasExplicitPurchaseDate = Boolean(purchaseDate && ISO_DATE_RE.test(purchaseDate));
  const basePurchaseDate = hasExplicitPurchaseDate ? purchaseDate! : dueDate;
  const firstDueDate =
    card && !hasExplicitPurchaseDate
      ? cardInvoiceDueDate(dueDate, card.closing_day, card.due_day)
      : dueDate;

  const resolvedCategoryId =
    categoryName && categoryName.trim()
      ? categories.findOrCreate(userId, categoryName.trim(), txType).id
      : categoryId || null;
  const installmentsCount = Math.min(48, Math.max(1, Number(totalInstallments) || 1));
  const recurringCount = isRecurring ? Math.min(12, Math.max(1, Number(repeatMonths) || 6)) : 1;
  const now = new Date().toISOString();

  if (installmentsCount > 1) {
    const groupId = crypto.randomUUID();
    const totalCents = Math.round(Number(amount) * 100);
    const baseCents = Math.floor(totalCents / installmentsCount);
    const installmentValue = baseCents / 100;

    runInTransaction(() => {
      for (let i = 1; i <= installmentsCount; i++) {
        const targetDueDate = addMonthsToDate(firstDueDate, i - 1);
        const installmentStatus = i === 1 && status === 'PAID' ? 'PAID' : 'PENDING';
        const label = `${description.trim()} (Parcela ${i}/${installmentsCount})`;
        // A última parcela absorve os centavos que sobram da divisão (ex.: 100 / 3 = 33,33 + 33,33 + 33,34)
        const thisValue =
          i === installmentsCount
            ? (totalCents - baseCents * (installmentsCount - 1)) / 100
            : installmentValue;

        transactions.insert({
          id: crypto.randomUUID(),
          user_id: userId,
          account_id: creditCardId ? null : accountId || null,
          credit_card_id: creditCardId || null,
          category_id: resolvedCategoryId,
          installment_group_id: groupId,
          type: txType,
          description_enc: encryptField(label, dekHex),
          amount_enc: encryptField(thisValue, dekHex),
          competence_date: basePurchaseDate,
          due_date: targetDueDate,
          status: installmentStatus,
          is_recurring: false,
          installment_number: i,
          total_installments: installmentsCount,
          created_at: now,
        });

        if (installmentStatus === 'PAID' && accountId && !creditCardId) {
          const acc = accounts.get(accountId, userId);
          if (acc) {
            const currentBal = decryptNumber(acc.balance_enc, dekHex);
            const nextBal =
              txType === 'INCOME' ? currentBal + thisValue : currentBal - thisValue;
            accounts.update(accountId, userId, {
              balance_enc: encryptField(Number(nextBal.toFixed(2)), dekHex),
              updated_at: now,
            });
          }
        }
      }
    });

    res.status(201).json({
      message: `Parcelamento em ${installmentsCount}x de R$ ${installmentValue.toFixed(2).replace('.', ',')} lançado nos próximos meses!`,
    });
    return;
  }

  const groupId = isRecurring && recurringCount > 1 ? crypto.randomUUID() : null;
  const numAmount = Number(Number(amount).toFixed(2));

  runInTransaction(() => {
    for (let m = 0; m < recurringCount; m++) {
      const targetDueDate = addMonthsToDate(firstDueDate, m);
      const currentStatus = m === 0 ? status || (creditCardId ? 'PENDING' : 'PAID') : 'PENDING';

      transactions.insert({
        id: crypto.randomUUID(),
        user_id: userId,
        account_id: creditCardId ? null : accountId || null,
        credit_card_id: creditCardId || null,
        category_id: resolvedCategoryId,
        installment_group_id: groupId,
        type: txType,
        description_enc: encryptField(description.trim(), dekHex),
        amount_enc: encryptField(numAmount, dekHex),
        competence_date: addMonthsToDate(basePurchaseDate, m),
        due_date: targetDueDate,
        status: currentStatus,
        is_recurring: Boolean(isRecurring),
        installment_number: 1,
        total_installments: 1,
        created_at: now,
      });

      if (currentStatus === 'PAID' && accountId && !creditCardId) {
        const acc = accounts.get(accountId, userId);
        if (acc) {
          const currentBal = decryptNumber(acc.balance_enc, dekHex);
          const nextBal = txType === 'INCOME' ? currentBal + numAmount : currentBal - numAmount;
          accounts.update(accountId, userId, {
            balance_enc: encryptField(Number(nextBal.toFixed(2)), dekHex),
            updated_at: now,
          });
        }
      }
    }
  });

  res.status(201).json({
    message:
      isRecurring && recurringCount > 1
        ? `Conta fixa registrada e projetada para ${recurringCount} meses!`
        : 'Lançamento registrado com sucesso!',
  });
});

/**
 * PATCH /api/finance/transactions/:id/status
 */
router.patch('/transactions/:id/status', (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body as { status?: 'PAID' | 'PENDING' };
  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;

  if (status !== 'PAID' && status !== 'PENDING') {
    res.status(400).json({ error: 'Status inválido.' });
    return;
  }

  const tx = transactions.get(id, userId);
  if (!tx) {
    res.status(404).json({ error: 'Lançamento não encontrado.' });
    return;
  }

  if (tx.status === status) {
    res.json({ message: 'Status já atualizado.' });
    return;
  }

  const amount = decryptNumber(tx.amount_enc, dekHex);

  runInTransaction(() => {
    if (tx.account_id) {
      const acc = accounts.get(tx.account_id, userId);
      if (acc) {
        const currentBal = decryptNumber(acc.balance_enc, dekHex);
        const delta =
          status === 'PAID'
            ? tx.type === 'INCOME'
              ? amount
              : -amount
            : tx.type === 'INCOME'
            ? -amount
            : amount;
        accounts.update(tx.account_id, userId, {
          balance_enc: encryptField(Number((currentBal + delta).toFixed(2)), dekHex),
          updated_at: new Date().toISOString(),
        });
      }
    }
    transactions.setStatus(id, userId, status);
  });

  addAuditLog({
    userId,
    actorRole: 'TITULAR',
    action: status === 'PAID' ? 'TRANSACTION_MARKED_PAID' : 'TRANSACTION_MARKED_PENDING',
    details: `Status de lançamento alterado para ${status}.`,
    ipAddress: req.ip || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'Web',
  });

  const msg =
    tx.type === 'INCOME'
      ? status === 'PAID'
        ? 'Entrada marcada como RECEBIDA!'
        : 'Entrada marcada como A RECEBER.'
      : status === 'PAID'
      ? 'Conta/Compra quitada (PAGA)!'
      : 'Conta marcada como A PAGAR.';
  res.json({ message: msg });
});

/**
 * PUT /api/finance/transactions/:id
 * Edita descrição, valor, data da compra, data de vencimento, situação e categoria de um lançamento.
 */
router.put('/transactions/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { description, amount, competenceDate, dueDate, status, categoryName } = req.body as {
    description?: string;
    amount?: number;
    competenceDate?: string;
    dueDate?: string;
    status?: 'PAID' | 'PENDING';
    categoryName?: string | null;
  };
  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;

  const tx = transactions.get(id, userId);
  if (!tx) {
    res.status(404).json({ error: 'Lançamento não encontrado.' });
    return;
  }

  const oldAmount = decryptNumber(tx.amount_enc, dekHex);
  const newAmount =
    amount !== undefined && Number(amount) > 0 ? Number(Number(amount).toFixed(2)) : oldAmount;
  const nextStatus = status === 'PAID' || status === 'PENDING' ? status : tx.status;

  if (dueDate && !ISO_DATE_RE.test(dueDate)) {
    res.status(400).json({ error: 'Data de vencimento inválida.' });
    return;
  }
  if (competenceDate && !ISO_DATE_RE.test(competenceDate)) {
    res.status(400).json({ error: 'Data da compra inválida.' });
    return;
  }

  const resolvedCategoryId =
    categoryName !== undefined
      ? categoryName && categoryName.trim()
        ? categories.findOrCreate(userId, categoryName.trim(), tx.type === 'INCOME' ? 'INCOME' : 'EXPENSE').id
        : null
      : tx.category_id;

  runInTransaction(() => {
    if (tx.account_id) {
      const acc = accounts.get(tx.account_id, userId);
      if (acc) {
        const currentBal = decryptNumber(acc.balance_enc, dekHex);
        const oldEffect =
          tx.status === 'PAID' ? (tx.type === 'INCOME' ? oldAmount : -oldAmount) : 0;
        const newEffect =
          nextStatus === 'PAID' ? (tx.type === 'INCOME' ? newAmount : -newAmount) : 0;
        const delta = newEffect - oldEffect;
        if (delta !== 0) {
          accounts.update(tx.account_id, userId, {
            balance_enc: encryptField(Number((currentBal + delta).toFixed(2)), dekHex),
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    transactions.update(id, userId, {
      description_enc: description && description.trim() ? encryptField(description.trim(), dekHex) : undefined,
      amount_enc: newAmount !== oldAmount ? encryptField(newAmount, dekHex) : undefined,
      competence_date: competenceDate || undefined,
      due_date: dueDate || undefined,
      status: nextStatus !== tx.status ? nextStatus : undefined,
      category_id: resolvedCategoryId,
    });
  });

  res.json({ message: 'Lançamento atualizado com sucesso!' });
});

/**
 * DELETE /api/finance/transactions/:id
 */
router.delete('/transactions/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const deleteGroup = req.query.deleteGroup === 'true';
  const userId = req.userSession!.userId;
  const dekHex = req.vault!.dekHex!;

  const tx = transactions.get(id, userId);
  if (!tx) {
    res.status(404).json({ error: 'Lançamento não encontrado.' });
    return;
  }

  const toDelete =
    deleteGroup && tx.installment_group_id
      ? transactions.byGroup(tx.installment_group_id, userId)
      : [tx];

  runInTransaction(() => {
    for (const item of toDelete) {
      if (item.status === 'PAID' && item.account_id) {
        const acc = accounts.get(item.account_id, userId);
        if (acc) {
          const currentBal = decryptNumber(acc.balance_enc, dekHex);
          const amount = decryptNumber(item.amount_enc, dekHex);
          const reverted = item.type === 'INCOME' ? currentBal - amount : currentBal + amount;
          accounts.update(item.account_id, userId, {
            balance_enc: encryptField(Number(reverted.toFixed(2)), dekHex),
            updated_at: new Date().toISOString(),
          });
        }
      }
      transactions.remove(item.id, userId);
    }
  });

  res.json({ message: 'Lançamento excluído com sucesso.' });
});

export default router;
