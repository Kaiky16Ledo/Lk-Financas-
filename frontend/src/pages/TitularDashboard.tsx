import React, { useState, useEffect, useCallback } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  LogOut,
  Sun,
  Moon,
  Type,
  PlusCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Wallet,
  CreditCard,
  TrendingUp,
  FileSpreadsheet,
  Printer,
  ShieldCheck,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Repeat,
  Layers,
  KeyRound,
  ArrowRightLeft,
  Search,
  PieChart,
} from 'lucide-react';
import { LkLogo } from '../components/LkLogo';
import {
  AccountItem,
  apiRequest,
  CreditCardItem,
  FinanceOverviewResponse,
  formatCurrency,
  formatDateBR,
  InvestmentItem,
  TransactionItem,
  UserProfile,
} from '../services/api';

interface TitularDashboardProps {
  user: UserProfile;
  fontSize: 'NORMAL' | 'LARGE';
  theme: 'LIGHT' | 'DARK';
  onToggleFontSize: () => void;
  onToggleTheme: () => void;
  onPinLocked: () => void;
  onLogout: () => void;
}

type ActiveTab = 'OVERVIEW' | 'TRANSACTIONS' | 'ACCOUNTS_CARDS' | 'INVESTMENTS' | 'REPORTS_SECURITY';

/** Data de hoje no fuso local do aparelho (evita virar o dia às 21h por causa do UTC). */
function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Calcula o vencimento sugerido da fatura do cartão a partir da data da compra, dia de fechamento e dia de vencimento. */
function computeCardInvoiceDueDate(purchaseDate: string, closingDay: number, dueDay: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) return purchaseDate;
  const [y, m, d] = purchaseDate.split('-').map(Number);
  const close = Math.max(1, Math.min(31, Number(closingDay) || 5));
  const due = Math.max(1, Math.min(31, Number(dueDay) || 12));
  const monthOffset = (d >= close ? 1 : 0) + (due <= close ? 1 : 0);
  const target = new Date(y, m - 1 + monthOffset, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(
    Math.min(due, lastDay)
  ).padStart(2, '0')}`;
}

/** Retorna o rótulo exato da situação separado em Recebido, Pago, A Receber e A Pagar. */
function getSituationLabel(type: string, status: 'PAID' | 'PENDING'): string {
  if (type === 'INCOME') {
    return status === 'PAID' ? 'Recebido' : 'A Receber';
  }
  return status === 'PAID' ? 'Pago' : 'A Pagar';
}

export const TitularDashboard: React.FC<TitularDashboardProps> = ({
  user,
  fontSize,
  theme,
  onToggleFontSize,
  onToggleTheme,
  onPinLocked,
  onLogout,
}) => {
  const [selectedMonth, setSelectedMonth] = useState(() => localTodayISO().slice(0, 7));
  const [activeTab, setActiveTab] = useState<ActiveTab>('OVERVIEW');
  const [hideValues, setHideValues] = useState(false);
  const [data, setData] = useState<FinanceOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Estado do formulário de novo lançamento
  const [txType, setTxType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [txDesc, setTxDesc] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txPurchaseDate, setTxPurchaseDate] = useState(() => localTodayISO());
  const [txDueDate, setTxDueDate] = useState(() => localTodayISO());
  const [txStatus, setTxStatus] = useState<'PAID' | 'PENDING'>('PAID');
  const [txPaymentMethod, setTxPaymentMethod] = useState<'ACCOUNT' | 'CARD'>('ACCOUNT');
  const [txAccountId, setTxAccountId] = useState('');
  const [txCardId, setTxCardId] = useState('');
  const [txCategoryName, setTxCategoryName] = useState('');
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [txMode, setTxMode] = useState<'SINGLE' | 'INSTALLMENT' | 'RECURRING'>('SINGLE');
  const [txInstallments, setTxInstallments] = useState('2');
  const [txRepeatMonths, setTxRepeatMonths] = useState('6');

  // Estado de nova conta bancária
  const [accName, setAccName] = useState('');
  const [accBank, setAccBank] = useState('');
  const [accType, setAccType] = useState<'CHECKING' | 'SAVINGS' | 'CASH'>('CHECKING');
  const [accBalance, setAccBalance] = useState('');

  // Estado de novo cartão de crédito, relatório por cartão e quitação de fatura
  const [cardName, setCardName] = useState('');
  const [cardLimit, setCardLimit] = useState('');
  const [cardClosing, setCardClosing] = useState('5');
  const [cardDue, setCardDue] = useState('12');
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [cardReportScope, setCardReportScope] = useState<'MONTH' | 'PURCHASE' | 'ALL'>('ALL');
  const [payingCardId, setPayingCardId] = useState<string | null>(null);
  const [payCardAccountId, setPayCardAccountId] = useState<string>('');

  // Estado de novo investimento / patrimônio
  const [invName, setInvName] = useState('');
  const [invBank, setInvBank] = useState('');
  const [invCategory, setInvCategory] = useState<'FIXED_INCOME' | 'SAVINGS' | 'PENSION' | 'PATRIMONY'>('FIXED_INCOME');
  const [invPrincipal, setInvPrincipal] = useState('');
  const [invCurrent, setInvCurrent] = useState('');
  const [invYield, setInvYield] = useState('');

  // Estados de Edição (Lançamento, Conta Bancária, Cartão de Crédito e Investimento)
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editTxDesc, setEditTxDesc] = useState('');
  const [editTxAmount, setEditTxAmount] = useState('');
  const [editTxPurchaseDate, setEditTxPurchaseDate] = useState('');
  const [editTxDueDate, setEditTxDueDate] = useState('');
  const [editTxStatus, setEditTxStatus] = useState<'PAID' | 'PENDING'>('PAID');
  const [editTxCategoryName, setEditTxCategoryName] = useState('');

  const [editingAccId, setEditingAccId] = useState<string | null>(null);
  const [editAccName, setEditAccName] = useState('');
  const [editAccBank, setEditAccBank] = useState('');
  const [editAccBalance, setEditAccBalance] = useState('');

  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editCardName, setEditCardName] = useState('');
  const [editCardLimit, setEditCardLimit] = useState('');
  const [editCardClosing, setEditCardClosing] = useState('');
  const [editCardDue, setEditCardDue] = useState('');

  const [editingInvId, setEditingInvId] = useState<string | null>(null);
  const [editInvName, setEditInvName] = useState('');
  const [editInvBank, setEditInvBank] = useState('');
  const [editInvCategory, setEditInvCategory] = useState<'FIXED_INCOME' | 'SAVINGS' | 'PENSION' | 'PATRIMONY'>('FIXED_INCOME');
  const [editInvPrincipal, setEditInvPrincipal] = useState('');
  const [editInvCurrent, setEditInvCurrent] = useState('');
  const [editInvYield, setEditInvYield] = useState('');

  // Estado de segurança (alterar senha / PIN / chave de emergência)
  const [secCurrentPassword, setSecCurrentPassword] = useState('');
  const [secNewPassword, setSecNewPassword] = useState('');
  const [secNewPin, setSecNewPin] = useState('');
  const [secRegenRecovery, setSecRegenRecovery] = useState(false);
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);

  // Estado de Transferência entre Contas e Aporte/Resgate de Investimentos
  const [transferMode, setTransferMode] = useState<
    'ACCOUNT_TO_ACCOUNT' | 'ACCOUNT_TO_INVESTMENT' | 'INVESTMENT_TO_ACCOUNT'
  >('ACCOUNT_TO_INVESTMENT');
  const [transferFromAccId, setTransferFromAccId] = useState('');
  const [transferToAccId, setTransferToAccId] = useState('');
  const [transferFromInvId, setTransferFromInvId] = useState('');
  const [transferToInvId, setTransferToInvId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');

  // Estado de Busca e Filtros Rápidos na Aba de Lançamentos (Separados: Recebido, Pago, A Receber, A Pagar)
  const [txSearchQuery, setTxSearchQuery] = useState('');
  const [txQuickFilter, setTxQuickFilter] = useState<
    'ALL' | 'INCOME_PAID' | 'EXPENSE_PAID' | 'INCOME_PENDING' | 'EXPENSE_PENDING'
  >('ALL');

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<FinanceOverviewResponse>(
        `/finance/overview?month=${selectedMonth}`
      );
      setData(res);
      // Mantém a seleção atual se ainda existir; senão escolhe a primeira disponível (ex.: após excluir uma conta)
      const keepOr = (list: { id: string }[], fallbackIndex = 0) => (prev: string) =>
        list.some((item) => item.id === prev) ? prev : list[fallbackIndex]?.id || list[0]?.id || '';
      setTxAccountId(keepOr(res.accounts));
      setTxCardId(keepOr(res.creditCards));
      setTxCategoryName((prev) =>
        res.categories.some((c) => c.name === prev) ? prev : res.categories[0]?.name || ''
      );
      setTransferFromAccId(keepOr(res.accounts));
      setTransferToAccId(keepOr(res.accounts, 1));
      setTransferFromInvId(keepOr(res.investments));
      setTransferToInvId(keepOr(res.investments));
    } catch (err: any) {
      if (err.status === 423 || err.pinLocked) {
        onPinLocked();
        return;
      }
      setError(err.message || 'Erro ao carregar dados financeiros.');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, onPinLocked]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Auto-Lock por inatividade (3 minutos sem mexer no mouse/teclado/toque)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const resetIdleTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        apiRequest('/auth/lock-pin', { method: 'POST' })
          .then(() => onPinLocked())
          .catch(() => {});
      }, 3 * 60 * 1000);
    };

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, resetIdleTimer));
    resetIdleTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, resetIdleTimer));
    };
  }, [onPinLocked]);

  const changeMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const date = new Date(y, m - 1 + delta, 1);
    const nextY = date.getFullYear();
    const nextM = String(date.getMonth() + 1).padStart(2, '0');
    setSelectedMonth(`${nextY}-${nextM}`);
  };

  const formatMonthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ];
    return `${months[(m - 1) % 12]} de ${y}`;
  };

  const handleManualLockPin = async () => {
    try {
      await apiRequest('/auth/lock-pin', { method: 'POST' });
      onPinLocked();
    } catch {
      onPinLocked();
    }
  };

  const handleToggleTransactionStatus = async (txId: string, currentStatus: 'PAID' | 'PENDING') => {
    const nextStatus = currentStatus === 'PAID' ? 'PENDING' : 'PAID';
    try {
      const res = await apiRequest<{ message: string }>(`/finance/transactions/${txId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteTransaction = async (txId: string, hasGroup: boolean) => {
    if (!window.confirm('Deseja realmente excluir este lançamento?')) return;
    const deleteGroup = hasGroup
      ? window.confirm(
          'Este lançamento faz parte de um parcelamento/conta fixa.\n\nOK = excluir TODAS as parcelas/meses dele\nCancelar = excluir só este'
        )
      : false;
    try {
      await apiRequest(`/finance/transactions/${txId}?deleteGroup=${deleteGroup}`, {
        method: 'DELETE',
      });
      showToast(deleteGroup ? 'Todas as parcelas foram removidas.' : 'Lançamento removido com sucesso.');
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const usingCard = txType === 'EXPENSE' && txPaymentMethod === 'CARD';
    if (usingCard && !txCardId) {
      setError('Cadastre um cartão de crédito na aba "3. Bancos & Cartões" antes de lançar compras no cartão.');
      return;
    }
    if (!usingCard && !txAccountId) {
      setError('Cadastre uma conta bancária ou carteira na aba "3. Bancos & Cartões" antes de lançar.');
      return;
    }
    try {
      const res = await apiRequest<{ message: string }>('/finance/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: txType,
          description: txDesc,
          amount: Number(txAmount),
          purchaseDate: usingCard ? txPurchaseDate : txDueDate,
          dueDate: txDueDate,
          status: txStatus,
          accountId: usingCard ? null : txAccountId,
          creditCardId: usingCard ? txCardId : null,
          categoryName: txCategoryName.trim() || null,
          isRecurring: txMode === 'RECURRING',
          repeatMonths: txMode === 'RECURRING' ? Number(txRepeatMonths) : 1,
          totalInstallments: txMode === 'INSTALLMENT' ? Number(txInstallments) : 1,
        }),
      });
      setTxDesc('');
      setTxAmount('');
      setShowNewCategoryInput(false);
      setNewCategoryInput('');
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePayCardInvoice = async (cardId: string, monthTarget: string) => {
    setError(null);
    try {
      const res = await apiRequest<{ message: string }>(`/finance/credit-cards/${cardId}/pay-invoice`, {
        method: 'POST',
        body: JSON.stringify({
          month: monthTarget,
          accountId: payCardAccountId || null,
        }),
      });
      setPayingCardId(null);
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddManualCategory = async () => {
    const nameToSave = (newCategoryInput || txCategoryName).trim();
    if (!nameToSave) return;
    try {
      const res = await apiRequest<{ message: string; category?: { name: string } }>('/finance/categories', {
        method: 'POST',
        body: JSON.stringify({ name: nameToSave, type: txType }),
      });
      setTxCategoryName(res.category?.name || nameToSave);
      setNewCategoryInput('');
      setShowNewCategoryInput(false);
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    try {
      await apiRequest(`/finance/categories/${catId}`, { method: 'DELETE' });
      showToast('Categoria removida.');
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ message: string }>('/finance/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: accName,
          institution: accBank,
          type: accType,
          balance: Number(accBalance),
        }),
      });
      setAccName('');
      setAccBank('');
      setAccBalance('');
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ message: string }>('/finance/credit-cards', {
        method: 'POST',
        body: JSON.stringify({
          name: cardName,
          limit: Number(cardLimit),
          closingDay: Number(cardClosing),
          dueDay: Number(cardDue),
          accountId: data?.accounts[0]?.id || null,
        }),
      });
      setCardName('');
      setCardLimit('');
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateInvestment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ message: string }>('/finance/investments', {
        method: 'POST',
        body: JSON.stringify({
          name: invName,
          institution: invBank,
          category: invCategory,
          principalAmount: Number(invPrincipal),
          currentValue: Number(invCurrent || invPrincipal),
          monthlyYield: Number(invYield || 0),
        }),
      });
      setInvName('');
      setInvBank('');
      setInvPrincipal('');
      setInvCurrent('');
      setInvYield('');
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // --- Handlers de Edição e Exclusão (Lançamentos, Contas, Cartões e Investimentos) ---
  const startEditingTx = (tx: TransactionItem) => {
    setEditingTxId(tx.id);
    setEditTxDesc(tx.description);
    setEditTxAmount(String(tx.amount));
    setEditTxPurchaseDate(tx.competenceDate || tx.dueDate);
    setEditTxDueDate(tx.dueDate);
    setEditTxStatus(tx.status);
    setEditTxCategoryName(tx.categoryName || '');
  };

  const handleSaveEditTx = async (txId: string) => {
    try {
      const res = await apiRequest<{ message: string }>(`/finance/transactions/${txId}`, {
        method: 'PUT',
        body: JSON.stringify({
          description: editTxDesc,
          amount: Number(editTxAmount),
          competenceDate: editTxPurchaseDate || editTxDueDate,
          dueDate: editTxDueDate,
          status: editTxStatus,
          categoryName: editTxCategoryName.trim() || 'Sem Categoria',
        }),
      });
      setEditingTxId(null);
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const startEditingAccount = (acc: AccountItem) => {
    setEditingAccId(acc.id);
    setEditAccName(acc.name);
    setEditAccBank(acc.institution);
    setEditAccBalance(String(acc.balance));
  };

  const handleSaveEditAccount = async (accId: string) => {
    try {
      const res = await apiRequest<{ message: string }>(`/finance/accounts/${accId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editAccName,
          institution: editAccBank,
          balance: Number(editAccBalance),
        }),
      });
      setEditingAccId(null);
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteAccount = async (accId: string, name: string) => {
    if (!window.confirm(`Deseja realmente remover a conta "${name}"?`)) return;
    try {
      await apiRequest(`/finance/accounts/${accId}`, { method: 'DELETE' });
      showToast('Conta removida com sucesso.');
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const startEditingCard = (card: CreditCardItem) => {
    setEditingCardId(card.id);
    setEditCardName(card.name);
    setEditCardLimit(String(card.limit));
    setEditCardClosing(String(card.closingDay));
    setEditCardDue(String(card.dueDay));
  };

  const handleSaveEditCard = async (cardId: string) => {
    try {
      const res = await apiRequest<{ message: string }>(`/finance/credit-cards/${cardId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editCardName,
          limit: Number(editCardLimit),
          closingDay: Number(editCardClosing),
          dueDay: Number(editCardDue),
        }),
      });
      setEditingCardId(null);
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteCard = async (cardId: string, name: string) => {
    if (
      !window.confirm(
        `Deseja realmente remover o cartão "${name}"?\n\nTodas as compras e parcelas lançadas nele também serão apagadas.`
      )
    )
      return;
    try {
      await apiRequest(`/finance/credit-cards/${cardId}`, { method: 'DELETE' });
      showToast('Cartão removido com sucesso.');
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const startEditingInvestment = (inv: InvestmentItem) => {
    setEditingInvId(inv.id);
    setEditInvName(inv.name);
    setEditInvBank(inv.institution);
    setEditInvCategory(inv.category);
    setEditInvPrincipal(String(inv.principalAmount));
    setEditInvCurrent(String(inv.currentValue));
    setEditInvYield(String(inv.monthlyYield));
  };

  const handleSaveEditInvestment = async (invId: string) => {
    try {
      const res = await apiRequest<{ message: string }>(`/finance/investments/${invId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editInvName,
          institution: editInvBank,
          category: editInvCategory,
          principalAmount: Number(editInvPrincipal),
          currentValue: Number(editInvCurrent),
          monthlyYield: Number(editInvYield),
        }),
      });
      setEditingInvId(null);
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteInvestment = async (invId: string, name: string) => {
    if (!window.confirm(`Deseja realmente remover o investimento "${name}"?`)) return;
    try {
      await apiRequest(`/finance/investments/${invId}`, { method: 'DELETE' });
      showToast('Investimento removido com sucesso.');
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiRequest<{ message: string }>('/finance/transfers', {
        method: 'POST',
        body: JSON.stringify({
          mode: transferMode,
          fromAccountId:
            transferMode === 'ACCOUNT_TO_ACCOUNT' || transferMode === 'ACCOUNT_TO_INVESTMENT'
              ? transferFromAccId
              : undefined,
          toAccountId:
            transferMode === 'ACCOUNT_TO_ACCOUNT' || transferMode === 'INVESTMENT_TO_ACCOUNT'
              ? transferToAccId
              : undefined,
          fromInvestmentId:
            transferMode === 'INVESTMENT_TO_ACCOUNT' ? transferFromInvId : undefined,
          toInvestmentId:
            transferMode === 'ACCOUNT_TO_INVESTMENT' ? transferToInvId : undefined,
          amount: Number(transferAmount),
        }),
      });
      setTransferAmount('');
      showToast(res.message);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNewlyGeneratedKey(null);
    try {
      const res = await apiRequest<{
        message: string;
        newRecoveryKey: string | null;
      }>('/auth/change-security', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: secCurrentPassword,
          newPassword: secNewPassword || undefined,
          newPin: secNewPin || undefined,
          regenerateRecovery: secRegenRecovery,
        }),
      });
      setSecCurrentPassword('');
      setSecNewPassword('');
      setSecNewPin('');
      setSecRegenRecovery(false);
      if (res.newRecoveryKey) {
        setNewlyGeneratedKey(res.newRecoveryKey);
      }
      showToast(res.message);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleExportCsv = () => {
    if (!data) return;
    const headers = [
      'Data Lancamento / Compra',
      'Data Vencimento',
      'Tipo',
      'Descricao',
      'Categoria',
      'Conta ou Cartao',
      'Situacao',
      'Valor (R$)',
    ];
    const rows = data.transactions.map((t) => [
      formatDateBR(t.competenceDate || t.dueDate),
      formatDateBR(t.dueDate),
      t.type === 'INCOME' ? 'Entrada' : 'Saida',
      `"${t.description.replace(/"/g, '""')}"`,
      `"${t.categoryName}"`,
      `"${t.accountName || t.creditCardName || 'Geral'}"`,
      getSituationLabel(t.type, t.status),
      t.amount.toFixed(2).replace('.', ','),
    ]);

    const csvContent =
      '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `LK-Financas-Extrato-${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getCardReportTransactions = (card: CreditCardItem, scope: 'MONTH' | 'PURCHASE' | 'ALL') => {
    const all = card.allCardTransactions || [];
    if (scope === 'ALL') return all;
    if (scope === 'PURCHASE') {
      return all.filter((t) => (t.competenceDate || t.dueDate).startsWith(selectedMonth));
    }
    return card.monthTransactions || [];
  };

  const handleExportCardCsv = (card: CreditCardItem, scope: 'MONTH' | 'PURCHASE' | 'ALL') => {
    const list = getCardReportTransactions(card, scope);
    const headers = [
      'Cartao',
      'Data da Compra (Lancamento)',
      'Vencimento da Fatura',
      'Descricao',
      'Categoria',
      'Parcela',
      'Situacao',
      'Valor (R$)',
    ];
    const rows = list.map((t) => [
      `"${card.name.replace(/"/g, '""')}"`,
      formatDateBR(t.competenceDate || t.dueDate),
      formatDateBR(t.dueDate),
      `"${t.description.replace(/"/g, '""')}"`,
      `"${t.categoryName}"`,
      t.totalInstallments > 1 ? `${t.installmentNumber}/${t.totalInstallments}` : '1/1',
      getSituationLabel(t.type, t.status),
      t.amount.toFixed(2).replace('.', ','),
    ]);

    const csvContent =
      '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = card.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    link.download = `LK-Relatorio-Cartao-${safeName}-${scope === 'ALL' ? 'Completo' : selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintCardReport = (card: CreditCardItem, scope: 'MONTH' | 'PURCHASE' | 'ALL') => {
    const list = getCardReportTransactions(card, scope);
    const total = list.reduce((sum, item) => sum + item.amount, 0);
    const periodLabel =
      scope === 'ALL'
        ? 'Todas as Compras e Faturas'
        : scope === 'PURCHASE'
        ? `Compras realizadas em ${formatMonthLabel(selectedMonth)}`
        : `Fatura com vencimento em ${formatMonthLabel(selectedMonth)}`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;

    const rowsHtml =
      list.length === 0
        ? `<tr><td colspan="6" style="padding:16px;text-align:center;color:#64748b;">Nenhum lançamento encontrado neste período.</td></tr>`
        : list
            .map(
              (t) => `
          <tr>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;">${formatDateBR(t.competenceDate || t.dueDate)}</td>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#b45309;font-weight:600;">${formatDateBR(t.dueDate)}</td>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:600;">${t.description}${t.totalInstallments > 1 ? ` (${t.installmentNumber}/${t.totalInstallments})` : ''}</td>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0;">${t.categoryName}</td>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0;">${getSituationLabel(t.type, t.status)}</td>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">${formatCurrency(t.amount)}</td>
          </tr>`
            )
            .join('');

    win.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>Relatório do Cartão ${card.name} — LK Finanças</title>
        <style>
          body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #047857; padding-bottom: 16px; margin-bottom: 20px; }
          .brand { font-size: 22px; font-weight: 800; color: #047857; }
          .summary { display: flex; gap: 24px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
          .summary div { flex: 1; }
          .label { font-size: 12px; color: #64748b; text-transform: uppercase; }
          .val { font-size: 18px; font-weight: 800; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 14px; }
          th { background: #f1f5f9; text-align: left; padding: 10px; border-bottom: 2px solid #cbd5e1; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">LK Finanças — Relatório por Cartão</div>
            <div style="font-size:14px;color:#475569;margin-top:4px;">Cartão: <strong>${card.name}</strong> • Período: <strong>${periodLabel}</strong></div>
          </div>
          <div style="text-align:right;font-size:12px;color:#475569;">
            Fecha dia ${card.closingDay} • Vence dia ${card.dueDay}<br/>
            Emitido em ${new Date().toLocaleDateString('pt-BR')}
          </div>
        </div>
        <div class="summary">
          <div><div class="label">Limite Total</div><div class="val">${formatCurrency(card.limit)}</div></div>
          <div><div class="label">Total deste Relatório</div><div class="val" style="color:#b45309;">${formatCurrency(total)}</div></div>
          <div><div class="label">Limite Disponível</div><div class="val" style="color:#047857;">${formatCurrency(card.availableLimit)}</div></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Data da Compra (Lançamento)</th>
              <th>Vencimento da Fatura</th>
              <th>Descrição / Compra</th>
              <th>Categoria</th>
              <th>Situação</th>
              <th style="text-align:right;">Valor</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <script>window.onload = () => { window.print(); };</script>
      </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-16">
      {/* Barra Superior de Acessibilidade, Logo LK e Segurança */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 shadow-sm no-print">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <LkLogo size="md" showText={true} subtitle={`Cofre de ${user.name}`} />

          <div className="flex flex-wrap items-center gap-2">
            {/* Botão Olho Mágico (Modo Privacidade) */}
            <button
              type="button"
              onClick={() => setHideValues((v) => !v)}
              className={`p-2.5 rounded-xl border transition ${
                hideValues
                  ? 'bg-amber-500 text-slate-950 border-amber-600'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              }`}
              title={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
              aria-label={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
            >
              {hideValues ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>

            {/* Botão Bloquear Agora (PIN) */}
            <button
              type="button"
              onClick={handleManualLockPin}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm shadow transition"
              title="Bloquear a tela imediatamente com PIN"
            >
              <Lock className="w-4 h-4" />
              <span>Bloquear (PIN)</span>
            </button>

            {/* Botão Sair */}
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-red-600/10 hover:bg-red-600/20 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 font-bold text-sm transition"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>

        {/* Barra de Navegação Principal e Seletor de Mês */}
        <div className="max-w-7xl mx-auto px-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap gap-1.5">
            {[
              { id: 'OVERVIEW', label: '1. Visão Geral', icon: Wallet },
              { id: 'TRANSACTIONS', label: '2. Contas & Parcelas', icon: PlusCircle },
              { id: 'ACCOUNTS_CARDS', label: '3. Bancos & Cartões', icon: CreditCard },
              { id: 'INVESTMENTS', label: '4. Investimentos & Patrimônio', icon: TrendingUp },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as ActiveTab)}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition ${
                    isActive
                      ? 'bg-emerald-700 text-white shadow-sm'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Seletor de Mês/Ano */}
          <div className="flex items-center gap-2 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 shadow-sm">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
              title="Mês anterior"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="font-extrabold text-sm sm:text-base min-w-[155px] text-center">
              {formatMonthLabel(selectedMonth)}
            </span>
            <button
              type="button"
              onClick={() => changeMonth(1)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
              title="Próximo mês"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 pt-6 space-y-6">
        {feedback && (
          <div className="p-4 rounded-2xl bg-emerald-600 text-white font-bold shadow-lg flex items-center justify-between no-print">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{feedback}</span>
            </div>
            <button onClick={() => setFeedback(null)} className="text-xs underline">
              Fechar
            </button>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-2xl bg-red-600 text-white font-bold shadow-lg flex items-center justify-between no-print">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-xs underline">
              Fechar
            </button>
          </div>
        )}

        {loading && !data ? (
          <div className="p-12 text-center font-bold text-slate-500">
            Descriptografando seu cofre LK com AES-256-GCM...
          </div>
        ) : data ? (
          <>
            {/* ALERTA DE CONTAS A VENCER NOS PRÓXIMOS 7 DIAS */}
            {data.upcomingAlerts.length > 0 && (
              <section className="bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-700 rounded-3xl p-5 shadow-sm no-print">
                <div className="flex items-center gap-2.5 text-amber-900 dark:text-amber-300 font-extrabold text-lg mb-3">
                  <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
                  <span>
                    Atenção: Você tem {data.upcomingAlerts.length} conta(s) pendente(s) vencida(s) ou vencendo nos próximos 7 dias
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {data.upcomingAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`flex items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border shadow-sm ${
                        alert.isOverdue
                          ? 'border-red-500 dark:border-red-700'
                          : 'border-amber-300 dark:border-amber-800'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          {alert.description}
                          {alert.isOverdue && (
                            <span className="px-2 py-0.5 rounded-md bg-red-600 text-white text-[11px] font-extrabold">
                              VENCIDA
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mt-0.5">
                          Vencimento: <span className="font-bold text-amber-700 dark:text-amber-400">{formatDateBR(alert.dueDate)}</span>
                          {' • '}
                          {alert.accountName || alert.creditCardName || alert.categoryName}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-extrabold text-red-600 dark:text-red-400">
                          {formatCurrency(alert.amount, hideValues)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleTransactionStatus(alert.id, alert.status)}
                          className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow transition"
                        >
                          Dar Baixa (Pago)
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ABA 1: VISÃO GERAL */}
            {activeTab === 'OVERVIEW' && (
              <div className="space-y-6">
                {/* 4 Cartões Principais de Patrimônio e Fluxo do Mês */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="text-sm font-bold text-slate-500 dark:text-slate-400">
                      Saldo Disponível em Contas
                    </div>
                    <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700 dark:text-emerald-400 mt-2">
                      {formatCurrency(data.summary.totalAccountsBalance, hideValues)}
                    </div>
                    <div className="text-xs text-slate-500 mt-2">
                      Soma de {data.accounts.length} conta(s) ativa(s)
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="text-sm font-bold text-slate-500 dark:text-slate-400">
                      Investimentos & Reserva
                    </div>
                    <div className="text-2xl sm:text-3xl font-extrabold text-sky-700 dark:text-sky-400 mt-2">
                      {formatCurrency(data.summary.totalInvestmentsValue, hideValues)}
                    </div>
                    <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-2">
                      Rendimento médio: +
                      {hideValues
                        ? '••,••%'
                        : `${data.summary.totalMonthlyYield.toFixed(2).replace('.', ',')}%`}
                      /mês
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="text-sm font-bold text-slate-500 dark:text-slate-400">
                      Entradas em {formatMonthLabel(selectedMonth)}
                    </div>
                    <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600 mt-2">
                      {formatCurrency(data.summary.monthIncome, hideValues)}
                    </div>
                    <div className="text-xs text-slate-500 mt-2">
                      {data.summary.prevMonth && (data.summary.prevMonthIncome || 0) > 0 ? (
                        <span
                          className={
                            (data.summary.incomeDiffAmount || 0) >= 0
                              ? 'text-emerald-400 font-semibold'
                              : 'text-amber-400 font-semibold'
                          }
                        >
                          {(data.summary.incomeDiffAmount || 0) >= 0 ? '↑ +' : '↓ -'}
                          {formatCurrency(Math.abs(data.summary.incomeDiffAmount || 0), hideValues)}{' '}
                          vs. {formatMonthLabel(data.summary.prevMonth).split(' ')[0]}
                        </span>
                      ) : (
                        'Aposentadoria, rendimentos e entradas'
                      )}
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="text-sm font-bold text-slate-500 dark:text-slate-400">
                      Despesas em {formatMonthLabel(selectedMonth)}
                    </div>
                    <div className="text-2xl sm:text-3xl font-extrabold text-red-600 dark:text-red-400 mt-2">
                      {formatCurrency(data.summary.monthExpenseTotal, hideValues)}
                    </div>
                    <div className="text-xs text-slate-500 mt-2 space-y-1">
                      <div>
                        Pago: {formatCurrency(data.summary.monthExpensePaid, hideValues)} • Falta:{' '}
                        {formatCurrency(data.summary.monthExpensePending, hideValues)}
                      </div>
                      {data.summary.prevMonth && (data.summary.prevMonthExpenseTotal || 0) > 0 && (
                        <div
                          className={`font-bold ${
                            (data.summary.expenseDiffAmount || 0) <= 0
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                          }`}
                        >
                          {(data.summary.expenseDiffAmount || 0) <= 0 ? (
                            <>
                              📉 {formatCurrency(Math.abs(data.summary.expenseDiffAmount || 0), hideValues)}{' '}
                              a menos que {formatMonthLabel(data.summary.prevMonth).split(' ')[0]}
                              {data.summary.expenseDiffPct !== null &&
                                data.summary.expenseDiffPct !== undefined &&
                                ` (${hideValues ? '••%' : `${data.summary.expenseDiffPct.toFixed(1).replace('.', ',')}%`})`}
                            </>
                          ) : (
                            <>
                              📈 {formatCurrency(Math.abs(data.summary.expenseDiffAmount || 0), hideValues)}{' '}
                              acima de {formatMonthLabel(data.summary.prevMonth).split(' ')[0]}
                              {data.summary.expenseDiffPct !== null &&
                                data.summary.expenseDiffPct !== undefined &&
                                ` (+${hideValues ? '••%' : `${data.summary.expenseDiffPct.toFixed(1).replace('.', ',')}%`})`}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Patrimônio Total Consolidado */}
                <div className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-lg flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="text-xs uppercase tracking-wider font-bold text-amber-300">
                      Patrimônio Líquido Consolidado (Contas + Investimentos)
                    </span>
                    <div className="text-3xl sm:text-4xl font-extrabold mt-1">
                      {formatCurrency(data.summary.totalPatrimony, hideValues)}
                    </div>
                    <p className="text-sm text-emerald-100 mt-1">
                      Todos os valores estão protegidos com criptografia AES-256-GCM exclusiva da sua chave.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('TRANSACTIONS')}
                    className="px-6 py-3.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-base shadow-md transition inline-flex items-center gap-2"
                  >
                    <PlusCircle className="w-5 h-5" />
                    Lançar Nova Conta ou Compra
                  </button>
                </div>

                {/* Balanço do Mês ("Sobrou / Faltou") + Gráfico Visual de Gastos por Categoria */}
                {(() => {
                  const netBalance = Number(
                    (data.summary.monthIncome - data.summary.monthExpenseTotal).toFixed(2)
                  );
                  const commitmentPct =
                    data.summary.monthIncome > 0
                      ? Math.min(
                          100,
                          Number(
                            ((data.summary.monthExpenseTotal / data.summary.monthIncome) * 100).toFixed(1)
                          )
                        )
                      : data.summary.monthExpenseTotal > 0
                      ? 100
                      : 0;

                  const categoryTotalsMap = new Map<string, number>();
                  data.transactions
                    .filter((t) => t.type === 'EXPENSE')
                    .forEach((t) => {
                      const cat = (t.categoryName || 'Sem Categoria').trim();
                      categoryTotalsMap.set(cat, (categoryTotalsMap.get(cat) || 0) + t.amount);
                    });

                  const categoryBreakdown = Array.from(categoryTotalsMap.entries())
                    .map(([name, total]) => ({
                      name,
                      total: Number(total.toFixed(2)),
                      pct:
                        data.summary.monthExpenseTotal > 0
                          ? Number(((total / data.summary.monthExpenseTotal) * 100).toFixed(1))
                          : 0,
                    }))
                    .sort((a, b) => b.total - a.total);

                  const barColors = [
                    'bg-emerald-500',
                    'bg-sky-500',
                    'bg-amber-500',
                    'bg-purple-500',
                    'bg-rose-500',
                    'bg-teal-500',
                  ];

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Card Balanço do Mês (Sobrou / Faltou) */}
                      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-4">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <h2 className="text-lg font-extrabold flex items-center gap-2">
                              <Wallet className="w-5 h-5 text-emerald-500" />
                              Balanço de {formatMonthLabel(selectedMonth)}
                            </h2>
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-extrabold ${
                                netBalance >= 0
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-red-500/15 text-red-400 border border-red-500/30'
                              }`}
                            >
                              {netBalance >= 0 ? '✓ Saldo Positivo (Sobrou)' : '⚠ Saldo Negativo (Faltou)'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            Diferença entre tudo que entrou e o total de contas/despesas do mês.
                          </p>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                          <div>
                            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                              {netBalance >= 0 ? 'Livre / Sobrou no Mês' : 'Excedente / Faltou no Mês'}
                            </div>
                            <div
                              className={`text-2xl sm:text-3xl font-extrabold mt-1 ${
                                netBalance >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {netBalance >= 0 ? '+' : '-'} {formatCurrency(Math.abs(netBalance), hideValues)}
                            </div>
                          </div>
                          <div className="text-right text-xs space-y-1 text-slate-400">
                            <div>
                              Entradas:{' '}
                              <strong className="text-emerald-400">
                                {formatCurrency(data.summary.monthIncome, hideValues)}
                              </strong>
                            </div>
                            <div>
                              Despesas:{' '}
                              <strong className="text-red-400">
                                {formatCurrency(data.summary.monthExpenseTotal, hideValues)}
                              </strong>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs font-bold">
                            <span className="text-slate-400">Comprometimento das Entradas do Mês</span>
                            <span
                              className={
                                commitmentPct > 90
                                  ? 'text-red-400'
                                  : commitmentPct > 70
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                              }
                            >
                              {hideValues ? '••%' : `${commitmentPct.toFixed(1).replace('.', ',')}%`}
                            </span>
                          </div>
                          <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                commitmentPct > 90
                                  ? 'bg-red-500'
                                  : commitmentPct > 70
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${Math.min(100, commitmentPct)}%` }}
                            />
                          </div>
                        </div>

                        {/* Comparativo Automático com o Mês Passado */}
                        {data.summary.prevMonth && (
                          <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div>
                              <span className="text-slate-400 font-semibold block">
                                Comparativo com {formatMonthLabel(data.summary.prevMonth)}:
                              </span>
                              <span className="text-slate-300">
                                Mês passado: Despesas de{' '}
                                <strong>
                                  {formatCurrency(data.summary.prevMonthExpenseTotal || 0, hideValues)}
                                </strong>
                              </span>
                            </div>
                            <div className="text-right font-extrabold">
                              {(data.summary.prevMonthExpenseTotal || 0) === 0 &&
                              data.summary.monthExpenseTotal === 0 ? (
                                <span className="text-slate-400">Sem despesas nos dois meses</span>
                              ) : (data.summary.expenseDiffAmount || 0) <= 0 ? (
                                <span className="text-emerald-400">
                                  📉 Gastou{' '}
                                  {formatCurrency(Math.abs(data.summary.expenseDiffAmount || 0), hideValues)}{' '}
                                  a menos
                                  {data.summary.expenseDiffPct !== null &&
                                    data.summary.expenseDiffPct !== undefined &&
                                    ` (${hideValues ? '••%' : `${data.summary.expenseDiffPct.toFixed(1).replace('.', ',')}%`})`}
                                </span>
                              ) : (
                                <span className="text-amber-400">
                                  📈 Gastou{' '}
                                  {formatCurrency(Math.abs(data.summary.expenseDiffAmount || 0), hideValues)}{' '}
                                  a mais
                                  {data.summary.expenseDiffPct !== null &&
                                    data.summary.expenseDiffPct !== undefined &&
                                    ` (+${hideValues ? '••%' : `${data.summary.expenseDiffPct.toFixed(1).replace('.', ',')}%`})`}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Card Gráfico de Gastos por Categoria */}
                      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                        <div className="flex items-center justify-between">
                          <h2 className="text-lg font-extrabold flex items-center gap-2">
                            <PieChart className="w-5 h-5 text-amber-400" />
                            Gastos por Categoria ({formatMonthLabel(selectedMonth)})
                          </h2>
                          <span className="text-xs font-bold text-slate-400">
                            {categoryBreakdown.length} categoria(s)
                          </span>
                        </div>

                        {categoryBreakdown.length === 0 ? (
                          <p className="text-sm text-slate-500 py-8 text-center">
                            Nenhuma despesa registrada neste mês para exibir o gráfico.
                          </p>
                        ) : (
                          <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                            {categoryBreakdown.map((item, idx) => (
                              <div key={item.name} className="space-y-1">
                                <div className="flex items-center justify-between text-xs font-bold">
                                  <span className="text-slate-200">{item.name}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-slate-400">
                                      {hideValues ? '••%' : `${item.pct.toFixed(1).replace('.', ',')}%`}
                                    </span>
                                    <span className="text-white font-extrabold">
                                      {formatCurrency(item.total, hideValues)}
                                    </span>
                                  </div>
                                </div>
                                <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${barColors[idx % barColors.length]}`}
                                    style={{ width: `${Math.max(4, item.pct)}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Resumo Rápido das Contas Bancárias e Lançamentos do Mês */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Coluna Contas */}
                  <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-extrabold flex items-center gap-2">
                        <Landmark className="w-5 h-5 text-emerald-600" />
                        Saldos por Conta
                      </h2>
                      <button
                        type="button"
                        onClick={() => setActiveTab('ACCOUNTS_CARDS')}
                        className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline"
                      >
                        Gerenciar
                      </button>
                    </div>
                    <div className="space-y-3">
                      {data.accounts.map((acc) => (
                        <div
                          key={acc.id}
                          className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex items-center justify-between"
                        >
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white">{acc.name}</div>
                            <div className="text-xs text-slate-500">{acc.institution}</div>
                          </div>
                          <div className="font-extrabold text-emerald-700 dark:text-emerald-400">
                            {formatCurrency(acc.balance, hideValues)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Coluna Extrato do Mês */}
                  <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-extrabold">
                        Movimentações de {formatMonthLabel(selectedMonth)}
                      </h2>
                      <button
                        type="button"
                        onClick={() => setActiveTab('TRANSACTIONS')}
                        className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline"
                      >
                        Ver todas / Adicionar
                      </button>
                    </div>

                    {data.transactions.length === 0 ? (
                      <p className="text-sm text-slate-500 py-8 text-center">
                        Nenhum lançamento registrado para este mês.
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {data.transactions.map((tx) => (
                          <div
                            key={tx.id}
                            className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3"
                          >
                            <div className="space-y-0.5">
                              <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <span>{tx.description}</span>
                                {tx.isRecurring && (
                                  <span className="px-2 py-0.5 text-xs rounded-md bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-300 font-semibold">
                                    Fixa Mensal
                                  </span>
                                )}
                                {tx.totalInstallments > 1 && (
                                  <span className="px-2 py-0.5 text-xs rounded-md bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300 font-semibold">
                                    {tx.installmentNumber}/{tx.totalInstallments}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {tx.creditCardId || (tx.competenceDate && tx.competenceDate !== tx.dueDate) ? (
                                  <>
                                    Compra em: <strong>{formatDateBR(tx.competenceDate || tx.dueDate)}</strong> •{' '}
                                    Vencimento: <strong className="text-amber-400">{formatDateBR(tx.dueDate)}</strong>
                                  </>
                                ) : (
                                  <>
                                    Vencimento: <strong>{formatDateBR(tx.dueDate)}</strong>
                                  </>
                                )}{' '}
                                • {tx.categoryName} • {tx.accountName || tx.creditCardName || 'Geral'}
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <span
                                className={`font-extrabold ${
                                  tx.type === 'INCOME'
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-red-600 dark:text-red-400'
                                }`}
                              >
                                {tx.type === 'INCOME' ? '+' : '-'} {formatCurrency(tx.amount, hideValues)}
                              </span>

                              <button
                                type="button"
                                onClick={() => handleToggleTransactionStatus(tx.id, tx.status)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1 transition ${
                                  tx.status === 'PAID'
                                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                                    : 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300 border border-amber-400'
                                }`}
                                title={
                                  tx.status === 'PAID'
                                    ? 'Clique para voltar para pendente'
                                    : tx.type === 'INCOME'
                                    ? 'Clique para marcar como Recebido'
                                    : 'Clique para Quitar / Pagar'
                                }
                              >
                                {tx.status === 'PAID' ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5" />{' '}
                                    {tx.type === 'INCOME' ? 'Recebido' : 'Pago'}
                                  </>
                                ) : (
                                  <>
                                    <Clock className="w-3.5 h-3.5" />{' '}
                                    {tx.type === 'INCOME'
                                      ? 'A Receber (Clique p/ receber)'
                                      : 'A Pagar (Clique p/ quitar)'}
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  startEditingTx(tx);
                                  setActiveTab('TRANSACTIONS');
                                }}
                                className="p-2 rounded-xl text-slate-400 hover:text-amber-400 hover:bg-slate-700/60 transition"
                                title="Modificar lançamento"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ABA 2: LANÇAMENTOS, CONTAS FIXAS E PARCELAMENTOS */}
            {activeTab === 'TRANSACTIONS' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Formulário de Novo Lançamento */}
                <form
                  onSubmit={handleCreateTransaction}
                  className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 h-fit"
                >
                  <h2 className="text-xl font-extrabold flex items-center gap-2">
                    <PlusCircle className="w-6 h-6 text-emerald-600" />
                    Novo Lançamento
                  </h2>

                  {/* Seletor Despesa vs Entrada */}
                  <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                    <button
                      type="button"
                      onClick={() => setTxType('EXPENSE')}
                      className={`py-2.5 rounded-xl font-bold text-sm transition ${
                        txType === 'EXPENSE'
                          ? 'bg-red-600 text-white shadow'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Saída / Conta
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTxType('INCOME');
                        setTxPaymentMethod('ACCOUNT');
                      }}
                      className={`py-2.5 rounded-xl font-bold text-sm transition ${
                        txType === 'INCOME'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Entrada / Receita
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm font-bold mb-1">Descrição</label>
                    <input
                      type="text"
                      required
                      value={txDesc}
                      onChange={(e) => setTxDesc(e.target.value)}
                      placeholder="Ex: Conta de Luz, Farmácia, Aposentadoria..."
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold mb-1">
                      {txMode === 'INSTALLMENT' ? 'Valor Total da Compra (R$)' : 'Valor (R$)'}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={txAmount}
                      onChange={(e) => setTxAmount(e.target.value)}
                      placeholder="0,00"
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-bold"
                    />
                  </div>

                  {txType === 'EXPENSE' && txPaymentMethod === 'CARD' ? (
                    <div className="p-3.5 rounded-2xl bg-purple-950/30 border border-purple-800/60 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-extrabold mb-1 text-purple-200">
                            1. Data da Compra (Lançamento)
                          </label>
                          <input
                            type="date"
                            required
                            value={txPurchaseDate}
                            onChange={(e) => {
                              const newPurchase = e.target.value;
                              setTxPurchaseDate(newPurchase);
                              const card = data.creditCards.find((c) => c.id === txCardId);
                              if (card && newPurchase) {
                                setTxDueDate(
                                  computeCardInvoiceDueDate(newPurchase, card.closingDay, card.dueDay)
                                );
                              }
                            }}
                            className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-purple-700 text-sm font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-extrabold mb-1 text-amber-300">
                            2. Vencimento da Fatura
                          </label>
                          <input
                            type="date"
                            required
                            value={txDueDate}
                            onChange={(e) => setTxDueDate(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-amber-600/80 text-sm font-bold text-amber-300"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] font-semibold text-purple-300">
                        Compra lançada em <strong>{formatDateBR(txPurchaseDate)}</strong> com vencimento da fatura em{' '}
                        <strong className="text-amber-300">{formatDateBR(txDueDate)}</strong>
                        {txMode === 'INSTALLMENT' ? ' (1ª parcela)' : ''}. Você pode ajustar o vencimento acima se desejar.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-bold mb-1">Data / Vencimento</label>
                      <input
                        type="date"
                        required
                        value={txDueDate}
                        onChange={(e) => {
                          setTxDueDate(e.target.value);
                          setTxPurchaseDate(e.target.value);
                        }}
                        className="w-full px-3 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                      />
                    </div>
                  )}

                  {/* Modalidade: Único, Parcelado ou Fixo Mensal */}
                  <div>
                    <label className="block text-sm font-bold mb-1.5">Repetição / Parcelamento</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setTxMode('SINGLE')}
                        className={`py-2 px-2 rounded-xl text-xs font-bold border transition ${
                          txMode === 'SINGLE'
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                        }`}
                      >
                        À Vista / Único
                      </button>
                      <button
                        type="button"
                        onClick={() => setTxMode('INSTALLMENT')}
                        className={`py-2 px-2 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1 ${
                          txMode === 'INSTALLMENT'
                            ? 'bg-purple-700 text-white border-purple-700'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                        }`}
                      >
                        <Layers className="w-3.5 h-3.5" /> Parcelado
                      </button>
                      <button
                        type="button"
                        onClick={() => setTxMode('RECURRING')}
                        className={`py-2 px-2 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1 ${
                          txMode === 'RECURRING'
                            ? 'bg-sky-700 text-white border-sky-700'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                        }`}
                      >
                        <Repeat className="w-3.5 h-3.5" /> Conta Fixa
                      </button>
                    </div>
                  </div>

                  {txMode === 'INSTALLMENT' && (
                    <div className="p-3.5 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-300 dark:border-purple-800">
                      <label className="block text-xs font-bold mb-1">
                        Quantidade de Parcelas (Ex: 2x até 24x)
                      </label>
                      <input
                        type="number"
                        min={2}
                        max={48}
                        value={txInstallments}
                        onChange={(e) => setTxInstallments(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-purple-300 dark:border-purple-700 font-bold"
                      />
                      {Number(txAmount) > 0 && Number(txInstallments) > 1 && (
                        <p className="text-xs font-semibold text-purple-800 dark:text-purple-300 mt-1.5">
                          Serão geradas {txInstallments} parcelas mensais de{' '}
                          {formatCurrency(Number(txAmount) / Number(txInstallments))}
                        </p>
                      )}
                    </div>
                  )}

                  {txMode === 'RECURRING' && (
                    <div className="p-3.5 rounded-2xl bg-sky-50 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-800">
                      <label className="block text-xs font-bold mb-1">
                        Projetar automaticamente para quantos meses?
                      </label>
                      <select
                        value={txRepeatMonths}
                        onChange={(e) => setTxRepeatMonths(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-sky-300 dark:border-sky-700 font-bold"
                      >
                        <option value="3">Próximos 3 meses</option>
                        <option value="6">Próximos 6 meses</option>
                        <option value="12">Próximos 12 meses (1 ano)</option>
                      </select>
                    </div>
                  )}

                  {/* Forma de Pagamento: Conta Bancária vs Cartão de Crédito */}
                  {txType === 'EXPENSE' && (
                    <div>
                      <label className="block text-sm font-bold mb-1">Meio de Pagamento</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setTxPaymentMethod('ACCOUNT');
                            setTxDueDate(txPurchaseDate);
                          }}
                          className={`py-2 rounded-xl text-xs font-bold border ${
                            txPaymentMethod === 'ACCOUNT'
                              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                              : 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          Conta / Dinheiro
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTxPaymentMethod('CARD');
                            setTxStatus('PENDING');
                            const card = data.creditCards.find((c) => c.id === txCardId) || data.creditCards[0];
                            if (card) {
                              setTxCardId(card.id);
                              setTxDueDate(
                                computeCardInvoiceDueDate(txPurchaseDate, card.closingDay, card.dueDay)
                              );
                            }
                          }}
                          className={`py-2 rounded-xl text-xs font-bold border ${
                            txPaymentMethod === 'CARD'
                              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                              : 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          Cartão de Crédito
                        </button>
                      </div>
                    </div>
                  )}

                  {txPaymentMethod === 'ACCOUNT' ? (
                    <div>
                      <label className="block text-sm font-bold mb-1">Conta Bancária / Carteira</label>
                      <select
                        value={txAccountId}
                        onChange={(e) => setTxAccountId(e.target.value)}
                        className="w-full px-3 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                      >
                        {data.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.institution})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-bold mb-1">Cartão de Crédito</label>
                      <select
                        value={txCardId}
                        onChange={(e) => {
                          const newCardId = e.target.value;
                          setTxCardId(newCardId);
                          const card = data.creditCards.find((c) => c.id === newCardId);
                          if (card && txPurchaseDate) {
                            setTxDueDate(
                              computeCardInvoiceDueDate(txPurchaseDate, card.closingDay, card.dueDay)
                            );
                          }
                        }}
                        className="w-full px-3 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                      >
                        {data.creditCards.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} (Fecha dia {c.closingDay} • Vence dia {c.dueDay})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-bold">Categoria</label>
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewCategoryInput((v) => !v);
                            setNewCategoryInput('');
                          }}
                          className="text-xs font-bold text-emerald-400 hover:underline"
                        >
                          {showNewCategoryInput ? 'Cancelar nova' : '+ Cadastrar Categoria'}
                        </button>
                      </div>

                      {!showNewCategoryInput && data.categories.length > 0 ? (
                        <div className="flex gap-2">
                          <select
                            value={txCategoryName}
                            onChange={(e) => {
                              if (e.target.value === '__ADD_NEW__') {
                                setShowNewCategoryInput(true);
                                setNewCategoryInput('');
                              } else {
                                setTxCategoryName(e.target.value);
                              }
                            }}
                            className="flex-1 px-3 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                          >
                            {data.categories.map((cat) => (
                              <option key={cat.id} value={cat.name}>
                                {cat.name}
                              </option>
                            ))}
                            <option value="__ADD_NEW__">+ Cadastrar nova categoria...</option>
                          </select>
                          {(() => {
                            const selectedCat = data.categories.find(
                              (c) => c.name.toLowerCase() === txCategoryName.toLowerCase()
                            );
                            if (!selectedCat) return null;
                            return (
                              <button
                                type="button"
                                onClick={() => handleDeleteCategory(selectedCat.id)}
                                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-400 border border-slate-700 text-xs font-bold shrink-0 transition"
                                title={`Remover a categoria "${selectedCat.name}"`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            );
                          })()}
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={showNewCategoryInput ? newCategoryInput : txCategoryName}
                            onChange={(e) => {
                              if (showNewCategoryInput) {
                                setNewCategoryInput(e.target.value);
                              } else {
                                setTxCategoryName(e.target.value);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddManualCategory();
                              }
                            }}
                            placeholder="Digite a categoria (Ex: Luz, Mercado, Médico...)"
                            className="flex-1 px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                          />
                          <button
                            type="button"
                            onClick={handleAddManualCategory}
                            className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shrink-0 transition"
                            title="Cadastrar categoria e ocultar na lista"
                          >
                            + Cadastrar
                          </button>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-bold mb-1">
                        Situação (Recebido / Pago / A Receber / A Pagar)
                      </label>
                      <select
                        value={`${txType}_${txStatus}`}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'INCOME_PAID') {
                            setTxType('INCOME');
                            setTxPaymentMethod('ACCOUNT');
                            setTxStatus('PAID');
                          } else if (val === 'INCOME_PENDING') {
                            setTxType('INCOME');
                            setTxPaymentMethod('ACCOUNT');
                            setTxStatus('PENDING');
                          } else if (val === 'EXPENSE_PAID') {
                            setTxType('EXPENSE');
                            setTxStatus('PAID');
                          } else if (val === 'EXPENSE_PENDING') {
                            setTxType('EXPENSE');
                            setTxStatus('PENDING');
                          }
                        }}
                        className="w-full px-3 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-bold"
                      >
                        <option value="INCOME_PAID">✓ Recebido</option>
                        <option value="EXPENSE_PAID">✓ Pago</option>
                        <option value="INCOME_PENDING">⏳ A Receber</option>
                        <option value="EXPENSE_PENDING">⏳ A Pagar</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-4 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-base shadow-lg transition"
                  >
                    Salvar no Cofre Criptografado
                  </button>
                </form>

                {/* Lista Completa de Lançamentos do Mês com Busca e Filtros Rápidos */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xl font-extrabold">
                      Lançamentos de {formatMonthLabel(selectedMonth)}
                    </h2>
                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800">
                      Total do Mês: {data.transactions.length} registro(s)
                    </span>
                  </div>

                  {/* Barra de Busca e Filtros Rápidos Separados */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={txSearchQuery}
                        onChange={(e) => setTxSearchQuery(e.target.value)}
                        placeholder="Buscar por descrição, categoria, banco ou cartão..."
                        className="w-full pl-10 pr-8 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm"
                      />
                      {txSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setTxSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                          title="Limpar busca"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {[
                        { id: 'ALL', label: 'Todos' },
                        { id: 'INCOME_PAID', label: '✓ Recebido' },
                        { id: 'EXPENSE_PAID', label: '✓ Pago' },
                        { id: 'INCOME_PENDING', label: '⏳ A Receber' },
                        { id: 'EXPENSE_PENDING', label: '⏳ A Pagar' },
                      ].map((f) => {
                        const active = txQuickFilter === f.id;
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setTxQuickFilter(f.id as any)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                              active
                                ? 'bg-emerald-700 text-white shadow-sm'
                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {(() => {
                    const q = txSearchQuery.trim().toLowerCase();
                    const filteredTxs = data.transactions.filter((tx) => {
                      if (txQuickFilter === 'INCOME_PAID' && !(tx.type === 'INCOME' && tx.status === 'PAID'))
                        return false;
                      if (txQuickFilter === 'EXPENSE_PAID' && !(tx.type === 'EXPENSE' && tx.status === 'PAID'))
                        return false;
                      if (txQuickFilter === 'INCOME_PENDING' && !(tx.type === 'INCOME' && tx.status === 'PENDING'))
                        return false;
                      if (txQuickFilter === 'EXPENSE_PENDING' && !(tx.type === 'EXPENSE' && tx.status === 'PENDING'))
                        return false;
                      if (!q) return true;
                      const haystack = [
                        tx.description,
                        tx.categoryName,
                        tx.accountName,
                        tx.creditCardName,
                      ]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase();
                      return haystack.includes(q);
                    });

                    // Compras no cartão feitas neste mês (competenceDate), mas cujo vencimento da fatura (dueDate) caiu no próximo mês
                    const cardPurchasesMadeInMonthForNextInvoice = data.creditCards
                      .flatMap((c) => c.allCardTransactions || [])
                      .filter(
                        (t) =>
                          (t.competenceDate || '').startsWith(selectedMonth) &&
                          !t.dueDate.startsWith(selectedMonth)
                      );

                    const filteredTotal = filteredTxs.reduce((acc, item) => acc + item.amount, 0);

                    return (
                      <>
                        {filteredTxs.length === 0 ? (
                          <p className="text-slate-500 py-8 text-center">
                            {data.transactions.length === 0
                              ? 'Nenhum lançamento com vencimento neste mês. Use o formulário ao lado para adicionar.'
                              : 'Nenhum lançamento encontrado para este filtro ou busca.'}
                          </p>
                        ) : (
                          <>
                            {(txQuickFilter !== 'ALL' || q) && (
                              <div className="flex items-center justify-between text-xs font-bold px-3.5 py-2 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300">
                                <span>Exibindo {filteredTxs.length} lançamento(s) no filtro</span>
                                <span>Soma dos itens filtrados: {formatCurrency(filteredTotal, hideValues)}</span>
                              </div>
                            )}
                            <div className="space-y-3">
                              {filteredTxs.map((tx) => (
                                <div
                                  key={tx.id}
                                  className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-3"
                                >
                                  {editingTxId === tx.id ? (
                                    <div className="space-y-3">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                                          Modificando Lançamento
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => setEditingTxId(null)}
                                          className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1"
                                        >
                                          <X className="w-3.5 h-3.5" /> Cancelar
                                        </button>
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        <div>
                                          <label className="block text-xs font-bold mb-1 text-slate-400">
                                            Descrição
                                          </label>
                                          <input
                                            type="text"
                                            value={editTxDesc}
                                            onChange={(e) => setEditTxDesc(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-bold mb-1 text-slate-400">
                                            Categoria
                                          </label>
                                          {data.categories.length > 0 ? (
                                            <select
                                              value={editTxCategoryName}
                                              onChange={(e) => setEditTxCategoryName(e.target.value)}
                                              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold"
                                            >
                                              {data.categories.map((cat) => (
                                                <option key={cat.id} value={cat.name}>
                                                  {cat.name}
                                                </option>
                                              ))}
                                            </select>
                                          ) : (
                                            <input
                                              type="text"
                                              value={editTxCategoryName}
                                              onChange={(e) => setEditTxCategoryName(e.target.value)}
                                              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm"
                                            />
                                          )}
                                        </div>
                                        <div>
                                          <label className="block text-xs font-bold mb-1 text-slate-400">
                                            Valor (R$)
                                          </label>
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={editTxAmount}
                                            onChange={(e) => setEditTxAmount(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-bold mb-1 text-slate-400">
                                            Situação
                                          </label>
                                          <select
                                            value={editTxStatus}
                                            onChange={(e) => setEditTxStatus(e.target.value as 'PAID' | 'PENDING')}
                                            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold"
                                          >
                                            {tx.type === 'INCOME' ? (
                                              <>
                                                <option value="PAID">✓ Recebido</option>
                                                <option value="PENDING">⏳ A Receber</option>
                                              </>
                                            ) : (
                                              <>
                                                <option value="PAID">✓ Pago</option>
                                                <option value="PENDING">⏳ A Pagar</option>
                                              </>
                                            )}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="block text-xs font-bold mb-1 text-slate-400">
                                            Data da Compra / Lançamento
                                          </label>
                                          <input
                                            type="date"
                                            value={editTxPurchaseDate}
                                            onChange={(e) => setEditTxPurchaseDate(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-bold mb-1 text-slate-400">
                                            Data de Vencimento
                                          </label>
                                          <input
                                            type="date"
                                            value={editTxDueDate}
                                            onChange={(e) => setEditTxDueDate(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm"
                                          />
                                        </div>
                                      </div>
                                      <div className="flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => setEditingTxId(null)}
                                          className="px-3.5 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold"
                                        >
                                          Cancelar
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleSaveEditTx(tx.id)}
                                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                                        >
                                          <Check className="w-4 h-4" /> Salvar Alterações
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div className="space-y-1">
                                        <div className="font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                                          <span>{tx.description}</span>
                                          {tx.creditCardName && (
                                            <span className="px-2 py-0.5 text-xs rounded-md bg-purple-950 text-purple-300 border border-purple-800 font-bold">
                                              💳 {tx.creditCardName}
                                            </span>
                                          )}
                                          {tx.isRecurring && (
                                            <span className="px-2 py-0.5 text-xs rounded-md bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 font-bold">
                                              Fixa Mensal
                                            </span>
                                          )}
                                          {tx.totalInstallments > 1 && (
                                            <span className="px-2 py-0.5 text-xs rounded-md bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 font-bold">
                                              Parcela {tx.installmentNumber}/{tx.totalInstallments}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400">
                                          {tx.creditCardId || (tx.competenceDate && tx.competenceDate !== tx.dueDate) ? (
                                            <>
                                              Compra em: <strong>{formatDateBR(tx.competenceDate || tx.dueDate)}</strong> •{' '}
                                              Vencimento Fatura: <strong className="text-amber-400">{formatDateBR(tx.dueDate)}</strong>
                                            </>
                                          ) : (
                                            <>
                                              Data / Vencimento: <strong>{formatDateBR(tx.dueDate)}</strong>
                                            </>
                                          )}{' '}
                                          • {tx.categoryName} • {tx.accountName || tx.creditCardName || 'Geral'}
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2">
                                        <span
                                          className={`font-extrabold text-base ${
                                            tx.type === 'INCOME'
                                              ? 'text-emerald-600 dark:text-emerald-400'
                                              : 'text-red-600 dark:text-red-400'
                                          }`}
                                        >
                                          {tx.type === 'INCOME' ? '+' : '-'} {formatCurrency(tx.amount, hideValues)}
                                        </span>

                                        <button
                                          type="button"
                                          onClick={() => handleToggleTransactionStatus(tx.id, tx.status)}
                                          className={`px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition ${
                                            tx.status === 'PAID'
                                              ? 'bg-emerald-600 text-white'
                                              : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                                          }`}
                                          title={
                                            tx.status === 'PAID'
                                              ? 'Clique para desmarcar'
                                              : tx.type === 'INCOME'
                                              ? 'Clique para marcar como Recebido'
                                              : 'Clique para Quitar / Pagar esta conta'
                                          }
                                        >
                                          {tx.status === 'PAID' ? (
                                            <>
                                              <CheckCircle2 className="w-3.5 h-3.5" />{' '}
                                              {tx.type === 'INCOME' ? 'Recebido' : 'Pago'}
                                            </>
                                          ) : (
                                            <>
                                              <Clock className="w-3.5 h-3.5" />{' '}
                                              {tx.type === 'INCOME'
                                                ? 'A Receber (Confirmar)'
                                                : 'A Pagar (Quitar)'}
                                            </>
                                          )}
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() => startEditingTx(tx)}
                                          className="p-2 rounded-xl text-slate-400 hover:text-amber-400 hover:bg-slate-700/60 transition"
                                          title="Modificar lançamento"
                                        >
                                          <Pencil className="w-4 h-4" />
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleDeleteTransaction(tx.id, Boolean(tx.installmentGroupId))
                                          }
                                          className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 transition"
                                          title="Excluir lançamento"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </>
                        )}

                        {cardPurchasesMadeInMonthForNextInvoice.length > 0 && (
                          <div className="mt-4 p-4 rounded-2xl bg-purple-950/30 border border-purple-800/60 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-extrabold uppercase tracking-wider text-purple-300">
                                💳 Compras no Cartão feitas em {formatMonthLabel(selectedMonth)} com vencimento no próximo mês
                              </span>
                              <button
                                type="button"
                                onClick={() => changeMonth(1)}
                                className="text-xs font-bold text-amber-300 hover:underline"
                              >
                                Ir para a fatura do próximo mês →
                              </button>
                            </div>
                            <div className="space-y-2">
                              {cardPurchasesMadeInMonthForNextInvoice.map((tx) => (
                                <div
                                  key={tx.id}
                                  className="p-3 rounded-xl bg-slate-900/90 border border-purple-800/40 flex flex-wrap items-center justify-between gap-2 text-xs"
                                >
                                  <div>
                                    <div className="font-bold text-white flex items-center gap-2">
                                      <span>{tx.description}</span>
                                      <span className="px-2 py-0.5 rounded bg-purple-900/70 text-purple-200 font-bold">
                                        {tx.creditCardName}
                                      </span>
                                    </div>
                                    <div className="text-slate-400 mt-0.5">
                                      Compra em: <strong className="text-white">{formatDateBR(tx.competenceDate)}</strong> •{' '}
                                      Vencimento da Fatura: <strong className="text-amber-300">{formatDateBR(tx.dueDate)}</strong> •{' '}
                                      {tx.categoryName}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-extrabold text-amber-400">
                                      {formatCurrency(tx.amount, hideValues)}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleTransactionStatus(tx.id, tx.status)}
                                      className={`px-2.5 py-1.5 rounded-lg font-bold transition ${
                                        tx.status === 'PAID'
                                          ? 'bg-emerald-600 text-white'
                                          : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                                      }`}
                                    >
                                      {tx.status === 'PAID' ? '✓ Pago' : '⏳ A Pagar (Quitar)'}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ABA 3: BANCOS, CARTEIRA E CARTÕES DE CRÉDITO */}
            {activeTab === 'ACCOUNTS_CARDS' && (
              <div className="space-y-6">
                {/* Painel Rápido: Transferência entre Contas & Aporte/Resgate de Investimentos */}
                <form
                  onSubmit={handleExecuteTransfer}
                  className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-extrabold flex items-center gap-2">
                        <ArrowRightLeft className="w-5 h-5 text-amber-400" />
                        Transferir entre Contas, Aplicar ou Resgatar Investimento
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Atualiza automaticamente os saldos de origem e destino de uma só vez.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {[
                        {
                          id: 'ACCOUNT_TO_ACCOUNT',
                          label: '🔄 Entre Contas / Carteira',
                        },
                        {
                          id: 'ACCOUNT_TO_INVESTMENT',
                          label: '📈 Aplicar (Conta → Investimento)',
                        },
                        {
                          id: 'INVESTMENT_TO_ACCOUNT',
                          label: '🏦 Resgatar (Investimento → Conta)',
                        },
                      ].map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setTransferMode(m.id as any)}
                          className={`px-3 py-2 rounded-xl text-xs font-bold transition ${
                            transferMode === m.id
                              ? 'bg-amber-500 text-slate-950 shadow'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                    {/* Origem */}
                    <div>
                      <label className="block text-xs font-bold mb-1 text-slate-400">
                        {transferMode === 'INVESTMENT_TO_ACCOUNT'
                          ? 'Investimento de Origem (Resgatar de)'
                          : 'Conta de Origem (Sai de)'}
                      </label>
                      {transferMode === 'INVESTMENT_TO_ACCOUNT' ? (
                        <select
                          value={transferFromInvId}
                          onChange={(e) => setTransferFromInvId(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                        >
                          {data.investments.map((inv) => (
                            <option key={inv.id} value={inv.id}>
                              {inv.name} ({formatCurrency(inv.currentValue, hideValues)})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select
                          value={transferFromAccId}
                          onChange={(e) => setTransferFromAccId(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                        >
                          {data.accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name} ({formatCurrency(acc.balance, hideValues)})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Destino */}
                    <div>
                      <label className="block text-xs font-bold mb-1 text-slate-400">
                        {transferMode === 'ACCOUNT_TO_INVESTMENT'
                          ? 'Investimento de Destino (Aplicar em)'
                          : 'Conta de Destino (Entra em)'}
                      </label>
                      {transferMode === 'ACCOUNT_TO_INVESTMENT' ? (
                        <select
                          value={transferToInvId}
                          onChange={(e) => setTransferToInvId(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                        >
                          {data.investments.map((inv) => (
                            <option key={inv.id} value={inv.id}>
                              {inv.name} ({formatCurrency(inv.currentValue, hideValues)})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select
                          value={transferToAccId}
                          onChange={(e) => setTransferToAccId(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                        >
                          {data.accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name} ({formatCurrency(acc.balance, hideValues)})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Valor */}
                    <div>
                      <label className="block text-xs font-bold mb-1 text-slate-400">
                        Valor da Operação (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        placeholder="0,00"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm font-bold"
                      />
                    </div>

                    {/* Botão Executar */}
                    <button
                      type="submit"
                      className="w-full py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-extrabold text-sm shadow transition"
                    >
                      {transferMode === 'ACCOUNT_TO_ACCOUNT'
                        ? 'Confirmar Transferência'
                        : transferMode === 'ACCOUNT_TO_INVESTMENT'
                        ? 'Confirmar Aporte'
                        : 'Confirmar Resgate'}
                    </button>
                  </div>
                </form>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Gestão de Contas Bancárias */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
                  <h2 className="text-xl font-extrabold flex items-center gap-2">
                    <Landmark className="w-6 h-6 text-emerald-600" />
                    Minhas Contas Bancárias & Carteira
                  </h2>

                  <div className="space-y-3">
                    {data.accounts.map((acc) => (
                      <div
                        key={acc.id}
                        className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-3"
                      >
                        {editingAccId === acc.id ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                                Modificando Conta / Carteira
                              </span>
                              <button
                                type="button"
                                onClick={() => setEditingAccId(null)}
                                className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1"
                              >
                                <X className="w-3.5 h-3.5" /> Cancelar
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              <div>
                                <label className="block text-xs font-bold mb-1 text-slate-400">
                                  Nome da Conta
                                </label>
                                <input
                                  type="text"
                                  value={editAccName}
                                  onChange={(e) => setEditAccName(e.target.value)}
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold mb-1 text-slate-400">
                                  Banco / Instituição
                                </label>
                                <input
                                  type="text"
                                  value={editAccBank}
                                  onChange={(e) => setEditAccBank(e.target.value)}
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold mb-1 text-slate-400">
                                  Saldo Atual (R$)
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editAccBalance}
                                  onChange={(e) => setEditAccBalance(e.target.value)}
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingAccId(null)}
                                className="px-3.5 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEditAccount(acc.id)}
                                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                              >
                                <Check className="w-4 h-4" /> Salvar Conta
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white">{acc.name}</div>
                              <div className="text-xs text-slate-500">
                                {acc.institution} •{' '}
                                {acc.type === 'CHECKING'
                                  ? 'Conta Corrente'
                                  : acc.type === 'SAVINGS'
                                  ? 'Poupança'
                                  : 'Dinheiro em Espécie'}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400 mr-1">
                                {formatCurrency(acc.balance, hideValues)}
                              </div>
                              <button
                                type="button"
                                onClick={() => startEditingAccount(acc)}
                                className="p-2 rounded-xl text-slate-400 hover:text-amber-400 hover:bg-slate-700/60 transition"
                                title="Modificar dados da conta"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteAccount(acc.id, acc.name)}
                                className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-950/40 transition"
                                title="Remover conta"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleCreateAccount} className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                    <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300">
                      Adicionar Nova Conta
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="text"
                        required
                        value={accName}
                        onChange={(e) => setAccName(e.target.value)}
                        placeholder="Nome (Ex: Conta Itaú)"
                        className="px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                      />
                      <input
                        type="text"
                        required
                        value={accBank}
                        onChange={(e) => setAccBank(e.target.value)}
                        placeholder="Banco / Instituição"
                        className="px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        value={accType}
                        onChange={(e) => setAccType(e.target.value as any)}
                        className="px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                      >
                        <option value="CHECKING">Conta Corrente</option>
                        <option value="SAVINGS">Poupança</option>
                        <option value="CASH">Dinheiro em Casa</option>
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={accBalance}
                        onChange={(e) => setAccBalance(e.target.value)}
                        placeholder="Saldo Atual (R$)"
                        className="px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm transition"
                    >
                      Cadastrar Conta
                    </button>
                  </form>
                </div>

                {/* Gestão de Cartões de Crédito */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
                  <h2 className="text-xl font-extrabold flex items-center gap-2">
                    <CreditCard className="w-6 h-6 text-purple-600" />
                    Cartões de Crédito & Faturas
                  </h2>

                  <div className="space-y-4">
                    {data.creditCards.map((card) => {
                      const isExpanded = expandedCardId === card.id;
                      const reportList = getCardReportTransactions(card, cardReportScope);
                      const allCardTxs = card.allCardTransactions || [];
                      const pendingMonthTxs = (card.monthTransactions || []).filter(
                        (t) => t.status === 'PENDING'
                      );
                      const allPendingTxs = allCardTxs.filter((t) => t.status === 'PENDING');
                      const targetInvoiceMonth =
                        pendingMonthTxs.length > 0
                          ? selectedMonth
                          : allPendingTxs.length > 0
                          ? allPendingTxs[0].dueDate.slice(0, 7)
                          : selectedMonth;
                      const targetInvoicePendingTotal = allPendingTxs
                        .filter((t) => t.dueDate.startsWith(targetInvoiceMonth))
                        .reduce((acc, item) => acc + item.amount, 0);

                      return (
                        <div
                          key={card.id}
                          className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 text-white space-y-4 shadow"
                        >
                          {editingCardId === card.id ? (
                            <div className="p-4 rounded-2xl bg-slate-950/90 border border-amber-500/60 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                                  Modificando Dados do Cartão
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setEditingCardId(null)}
                                  className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1"
                                >
                                  <X className="w-3.5 h-3.5" /> Cancelar
                                </button>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div>
                                  <label className="block text-xs font-bold mb-1 text-slate-300">
                                    Nome do Cartão
                                  </label>
                                  <input
                                    type="text"
                                    value={editCardName}
                                    onChange={(e) => setEditCardName(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm font-bold"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-bold mb-1 text-slate-300">
                                    Limite Total (R$)
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editCardLimit}
                                    onChange={(e) => setEditCardLimit(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm font-bold"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-bold mb-1 text-slate-300">
                                    Dia de Fechamento
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={31}
                                    value={editCardClosing}
                                    onChange={(e) => setEditCardClosing(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-bold mb-1 text-slate-300">
                                    Dia de Vencimento
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={31}
                                    value={editCardDue}
                                    onChange={(e) => setEditCardDue(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm"
                                  />
                                </div>
                              </div>
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingCardId(null)}
                                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEditCard(card.id)}
                                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                                >
                                  <Check className="w-4 h-4" /> Salvar Cartão
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-extrabold text-lg">{card.name}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs px-2.5 py-1 rounded-full bg-amber-400/20 text-amber-300 font-bold">
                                  Fecha dia {card.closingDay} • Vence dia {card.dueDay}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => startEditingCard(card)}
                                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 transition"
                                  title="Modificar dados do cartão"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCard(card.id, card.name)}
                                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-red-950/70 text-slate-300 hover:text-red-400 transition"
                                  title="Remover cartão"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-700 text-xs">
                            <div>
                              <div className="text-slate-400">Limite Total</div>
                              <div className="font-bold text-sm mt-0.5">
                                {formatCurrency(card.limit, hideValues)}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-400">Fatura ({formatMonthLabel(selectedMonth).split(' ')[0]})</div>
                              <div className="font-bold text-sm text-amber-400 mt-0.5">
                                {formatCurrency(card.monthInvoice, hideValues)}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-400">Total a Pagar</div>
                              <div className="font-bold text-sm text-rose-400 mt-0.5">
                                {formatCurrency(card.totalCommitted || 0, hideValues)}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-400">Disponível</div>
                              <div className="font-bold text-sm text-emerald-400 mt-0.5">
                                {formatCurrency(card.availableLimit, hideValues)}
                              </div>
                            </div>
                          </div>

                          {/* Botões de Quitar Fatura e Relatório por Cartão */}
                          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-700/80">
                            {allPendingTxs.length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPayingCardId(payingCardId === card.id ? null : card.id);
                                  setPayCardAccountId(data.accounts[0]?.id || '');
                                }}
                                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold inline-flex items-center gap-1.5 shadow transition"
                                title="Quitar / Pagar fatura deste cartão"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                Quitar / Pagar Cartão ({formatCurrency(targetInvoicePendingTotal, hideValues)})
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCardId(isExpanded ? null : card.id)
                              }
                              className="px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition"
                            >
                              {isExpanded ? 'Ocultar Relatório' : '📋 Ver Relatório do Cartão'}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleExportCardCsv(card, cardReportScope)}
                              className="px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1.5 transition"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5" />
                              Baixar Excel (CSV)
                            </button>

                            <button
                              type="button"
                              onClick={() => handlePrintCardReport(card, cardReportScope)}
                              className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold inline-flex items-center gap-1.5 transition"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              Imprimir / PDF
                            </button>
                          </div>

                          {/* Painel de Confirmação para Quitar / Pagar a Fatura do Cartão */}
                          {payingCardId === card.id && (
                            <div className="p-4 rounded-2xl bg-emerald-950/80 border border-emerald-500/60 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                                  <CheckCircle2 className="w-4 h-4" />
                                  Quitar / Pagar Fatura de {formatMonthLabel(targetInvoiceMonth)} ({formatCurrency(targetInvoicePendingTotal, hideValues)})
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setPayingCardId(null)}
                                  className="text-xs text-slate-300 hover:text-white"
                                >
                                  ✕ Fechar
                                </button>
                              </div>
                              <div>
                                <label className="block text-xs font-bold mb-1 text-emerald-200">
                                  Descontar o pagamento de qual conta bancária?
                                </label>
                                <select
                                  value={payCardAccountId}
                                  onChange={(e) => setPayCardAccountId(e.target.value)}
                                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-emerald-700 text-white text-xs font-bold"
                                >
                                  <option value="">Apenas dar baixa como Pago (sem descontar de conta)</option>
                                  {data.accounts.map((acc) => (
                                    <option key={acc.id} value={acc.id}>
                                      {acc.name} ({acc.institution}) — Saldo: {formatCurrency(acc.balance, hideValues)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setPayingCardId(null)}
                                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePayCardInvoice(card.id, targetInvoiceMonth)}
                                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold inline-flex items-center gap-1.5 shadow"
                                >
                                  <Check className="w-4 h-4" /> Confirmar Quitação da Fatura
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Painel Expansível com o Extrato Detalhado deste Cartão */}
                          {isExpanded && (
                            <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-700 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-extrabold uppercase tracking-wider text-purple-300">
                                  Relatório Detalhado — {card.name}
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setCardReportScope('MONTH')}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                                      cardReportScope === 'MONTH'
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-slate-800 text-slate-300'
                                    }`}
                                  >
                                    Vencimento em {formatMonthLabel(selectedMonth).split(' ')[0]} ({card.monthTransactions?.length || 0})
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setCardReportScope('PURCHASE')}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                                      cardReportScope === 'PURCHASE'
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-slate-800 text-slate-300'
                                    }`}
                                  >
                                    Compras de {formatMonthLabel(selectedMonth).split(' ')[0]}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setCardReportScope('ALL')}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                                      cardReportScope === 'ALL'
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-slate-800 text-slate-300'
                                    }`}
                                  >
                                    Todas as Compras ({card.allCardTransactions?.length || 0})
                                  </button>
                                </div>
                              </div>

                              {reportList.length === 0 ? (
                                <p className="text-xs text-slate-400 py-3 text-center">
                                  Nenhuma compra registrada neste cartão para o filtro selecionado.
                                </p>
                              ) : (
                                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                                  {reportList.map((tx) => (
                                    <div
                                      key={tx.id}
                                      className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs"
                                    >
                                      <div className="space-y-1">
                                        <div className="font-bold text-white flex items-center gap-2">
                                          <span>{tx.description}</span>
                                          {tx.totalInstallments > 1 && (
                                            <span className="px-2 py-0.5 rounded bg-purple-900/70 text-purple-200 text-[11px] font-bold">
                                              Parcela {tx.installmentNumber}/{tx.totalInstallments}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-slate-300 flex flex-wrap items-center gap-x-3 gap-y-1">
                                          <span>
                                            📅 Data da Compra (Lançamento):{' '}
                                            <strong className="text-white">
                                              {formatDateBR(tx.competenceDate || tx.dueDate)}
                                            </strong>
                                          </span>
                                          <span>
                                            💳 Vencimento da Fatura:{' '}
                                            <strong className="text-amber-300">{formatDateBR(tx.dueDate)}</strong>
                                          </span>
                                          <span className="text-slate-400">• {tx.categoryName}</span>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2 shrink-0">
                                        <div className="font-extrabold text-sm text-amber-400 mr-1">
                                          {formatCurrency(tx.amount, hideValues)}
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => handleToggleTransactionStatus(tx.id, tx.status)}
                                          className={`px-3 py-1.5 rounded-xl font-bold inline-flex items-center gap-1 transition ${
                                            tx.status === 'PAID'
                                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                              : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow'
                                          }`}
                                          title={
                                            tx.status === 'PAID'
                                              ? 'Compra já paga (clique se quiser voltar para A Pagar)'
                                              : 'Clique para Quitar / Pagar esta compra do cartão'
                                          }
                                        >
                                          {tx.status === 'PAID' ? (
                                            <>
                                              <CheckCircle2 className="w-3.5 h-3.5" /> Pago
                                            </>
                                          ) : (
                                            <>
                                              <CheckCircle2 className="w-3.5 h-3.5" /> Quitar / Pagar
                                            </>
                                          )}
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() => {
                                            startEditingTx(tx);
                                            setActiveTab('TRANSACTIONS');
                                          }}
                                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 transition"
                                          title="Modificar lançamento"
                                        >
                                          <Pencil className="w-3.5 h-3.5" />
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleDeleteTransaction(tx.id, Boolean(tx.installmentGroupId))
                                          }
                                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/70 text-slate-300 hover:text-red-400 transition"
                                          title="Excluir lançamento"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <form onSubmit={handleCreateCard} className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                    <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300">
                      Adicionar Novo Cartão
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="text"
                        required
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value)}
                        placeholder="Nome do Cartão"
                        className="px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                      />
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={cardLimit}
                        onChange={(e) => setCardLimit(e.target.value)}
                        placeholder="Limite Total (R$)"
                        className="px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold mb-1">Dia Fechamento</label>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={cardClosing}
                          onChange={(e) => setCardClosing(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">Dia Vencimento</label>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={cardDue}
                          onChange={(e) => setCardDue(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="w-full py-3 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-sm transition"
                    >
                      Cadastrar Cartão
                    </button>
                  </form>
                </div>
                </div>
              </div>
            )}

            {/* ABA 4: INVESTIMENTOS E PATRIMÔNIO */}
            {activeTab === 'INVESTMENTS' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <form
                  onSubmit={handleCreateInvestment}
                  className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 h-fit"
                >
                  <h2 className="text-xl font-extrabold flex items-center gap-2">
                    <TrendingUp className="w-6 h-6 text-sky-600" />
                    Nova Aplicação / Bem
                  </h2>

                  <div>
                    <label className="block text-sm font-bold mb-1">Nome da Aplicação / Bem</label>
                    <input
                      type="text"
                      required
                      value={invName}
                      onChange={(e) => setInvName(e.target.value)}
                      placeholder="Ex: CDB Banco Itaú, Tesouro Direto..."
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold mb-1">Instituição / Custódia</label>
                    <input
                      type="text"
                      required
                      value={invBank}
                      onChange={(e) => setInvBank(e.target.value)}
                      placeholder="Ex: Banco do Brasil, Caixa, Itaú..."
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold mb-1">Modalidade</label>
                    <select
                      value={invCategory}
                      onChange={(e) => setInvCategory(e.target.value as any)}
                      className="w-full px-3 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                    >
                      <option value="FIXED_INCOME">Renda Fixa (CDB, Tesouro, LCI/LCA)</option>
                      <option value="SAVINGS">Poupança</option>
                      <option value="PENSION">Previdência / Aposentadoria</option>
                      <option value="PATRIMONY">Imóvel / Veículo / Patrimônio</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-bold mb-1">Valor Aplicado Inicial (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={invPrincipal}
                      onChange={(e) => setInvPrincipal(e.target.value)}
                      placeholder="0,00"
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold mb-1">Saldo Bruto Atual (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={invCurrent}
                        onChange={(e) => setInvCurrent(e.target.value)}
                        placeholder="0,00"
                        className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold mb-1">Rendimento/Mês (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={invYield}
                        onChange={(e) => setInvYield(e.target.value)}
                        placeholder="Ex: 0,95%"
                        className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3.5 rounded-2xl bg-sky-700 hover:bg-sky-800 text-white font-extrabold shadow-lg transition"
                  >
                    Salvar Investimento Criptografado
                  </button>
                </form>

                <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xl font-extrabold">Carteira de Investimentos & Patrimônio</h2>
                    <div className="text-right">
                      <span className="text-xs text-slate-500 block">Total Acumulado</span>
                      <span className="text-xl font-extrabold text-sky-700 dark:text-sky-400">
                        {formatCurrency(data.summary.totalInvestmentsValue, hideValues)}
                      </span>
                    </div>
                  </div>

                  {/* Aporte ou Resgate Rápido direto na Aba de Investimentos */}
                  {data.accounts.length > 0 && data.investments.length > 0 && (
                    <form
                      onSubmit={handleExecuteTransfer}
                      className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-extrabold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                          <ArrowRightLeft className="w-4 h-4" />
                          Aporte (Aplicar) ou Resgate Rápido
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setTransferMode('ACCOUNT_TO_INVESTMENT')}
                            className={`px-3 py-1 rounded-lg text-xs font-bold ${
                              transferMode === 'ACCOUNT_TO_INVESTMENT'
                                ? 'bg-sky-600 text-white'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            📈 Aplicar (Conta → Investimento)
                          </button>
                          <button
                            type="button"
                            onClick={() => setTransferMode('INVESTMENT_TO_ACCOUNT')}
                            className={`px-3 py-1 rounded-lg text-xs font-bold ${
                              transferMode === 'INVESTMENT_TO_ACCOUNT'
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            🏦 Resgatar (Investimento → Conta)
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
                        <div>
                          <label className="block text-xs font-bold mb-1 text-slate-400">
                            {transferMode === 'INVESTMENT_TO_ACCOUNT'
                              ? 'Resgatar de'
                              : 'Sai da Conta'}
                          </label>
                          {transferMode === 'INVESTMENT_TO_ACCOUNT' ? (
                            <select
                              value={transferFromInvId}
                              onChange={(e) => setTransferFromInvId(e.target.value)}
                              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
                            >
                              {data.investments.map((inv) => (
                                <option key={inv.id} value={inv.id}>
                                  {inv.name} ({formatCurrency(inv.currentValue, hideValues)})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <select
                              value={transferFromAccId}
                              onChange={(e) => setTransferFromAccId(e.target.value)}
                              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
                            >
                              {data.accounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.name} ({formatCurrency(acc.balance, hideValues)})
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-bold mb-1 text-slate-400">
                            {transferMode === 'INVESTMENT_TO_ACCOUNT'
                              ? 'Entra na Conta'
                              : 'Aplicar em'}
                          </label>
                          {transferMode === 'INVESTMENT_TO_ACCOUNT' ? (
                            <select
                              value={transferToAccId}
                              onChange={(e) => setTransferToAccId(e.target.value)}
                              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
                            >
                              {data.accounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.name} ({formatCurrency(acc.balance, hideValues)})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <select
                              value={transferToInvId}
                              onChange={(e) => setTransferToInvId(e.target.value)}
                              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
                            >
                              {data.investments.map((inv) => (
                                <option key={inv.id} value={inv.id}>
                                  {inv.name} ({formatCurrency(inv.currentValue, hideValues)})
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-bold mb-1 text-slate-400">
                            Valor (R$)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={transferAmount}
                            onChange={(e) => setTransferAmount(e.target.value)}
                            placeholder="0,00"
                            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-bold"
                          />
                        </div>

                        <button
                          type="submit"
                          className="w-full py-2 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-extrabold text-xs shadow transition"
                        >
                          {transferMode === 'INVESTMENT_TO_ACCOUNT'
                            ? 'Confirmar Resgate'
                            : 'Confirmar Aporte'}
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-3">
                    {data.investments.map((inv) => (
                      <div
                        key={inv.id}
                        className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-3"
                      >
                        {editingInvId === inv.id ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                                Modificando Aplicação / Patrimônio
                              </span>
                              <button
                                type="button"
                                onClick={() => setEditingInvId(null)}
                                className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1"
                              >
                                <X className="w-3.5 h-3.5" /> Cancelar
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              <div>
                                <label className="block text-xs font-bold mb-1 text-slate-400">
                                  Nome da Aplicação
                                </label>
                                <input
                                  type="text"
                                  value={editInvName}
                                  onChange={(e) => setEditInvName(e.target.value)}
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold mb-1 text-slate-400">
                                  Instituição / Custódia
                                </label>
                                <input
                                  type="text"
                                  value={editInvBank}
                                  onChange={(e) => setEditInvBank(e.target.value)}
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold mb-1 text-slate-400">
                                  Modalidade
                                </label>
                                <select
                                  value={editInvCategory}
                                  onChange={(e) => setEditInvCategory(e.target.value as any)}
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm"
                                >
                                  <option value="FIXED_INCOME">Renda Fixa (CDB, Tesouro, LCI/LCA)</option>
                                  <option value="SAVINGS">Poupança</option>
                                  <option value="PENSION">Previdência / Aposentadoria</option>
                                  <option value="PATRIMONY">Imóvel / Veículo / Patrimônio</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-bold mb-1 text-slate-400">
                                  Valor Aplicado Inicial (R$)
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editInvPrincipal}
                                  onChange={(e) => setEditInvPrincipal(e.target.value)}
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold mb-1 text-slate-400">
                                  Saldo Atual (R$)
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editInvCurrent}
                                  onChange={(e) => setEditInvCurrent(e.target.value)}
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold mb-1 text-slate-400">
                                  Rendimento Mensal (%)
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editInvYield}
                                  onChange={(e) => setEditInvYield(e.target.value)}
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingInvId(null)}
                                className="px-3.5 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEditInvestment(inv.id)}
                                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                              >
                                <Check className="w-4 h-4" /> Salvar Investimento
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            <div>
                              <div className="font-extrabold text-base text-slate-900 dark:text-white">
                                {inv.name}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">
                                {inv.institution} • Aplicado: {formatCurrency(inv.principalAmount, hideValues)}
                              </div>
                            </div>

                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="text-xs text-slate-500">Rendimento Mensal</div>
                                <div className="font-bold text-emerald-600 dark:text-emerald-400">
                                  +
                                  {hideValues
                                    ? '••,••%'
                                    : `${inv.monthlyYield.toFixed(2).replace('.', ',')}%`}
                                  /mês
                                </div>
                              </div>
                              <div className="text-right mr-1">
                                <div className="text-xs text-slate-500">Valor Atual</div>
                                <div className="text-lg font-extrabold text-sky-700 dark:text-sky-400">
                                  {formatCurrency(inv.currentValue, hideValues)}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => startEditingInvestment(inv)}
                                className="p-2 rounded-xl text-slate-400 hover:text-amber-400 hover:bg-slate-700/60 transition"
                                title="Modificar dados do investimento"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteInvestment(inv.id, inv.name)}
                                className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-950/40 transition"
                                title="Remover investimento"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ABA 5: RELATÓRIOS (IMPOSTO DE RENDA / IMPRESSÃO) E SEGURANÇA */}
            {activeTab === 'REPORTS_SECURITY' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Exportação de Relatórios para Imposto de Renda / Papel */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
                  <h2 className="text-xl font-extrabold flex items-center gap-2">
                    <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
                    Relatórios & Imposto de Renda
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Exporte o demonstrativo mensal ou imprima em folha A4 / PDF com a identificação <strong>LK Finanças</strong> para conferência ou envio ao contador.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 no-print">
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      className="py-4 px-4 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold flex items-center justify-center gap-2 shadow transition"
                    >
                      <FileSpreadsheet className="w-5 h-5" />
                      Baixar Planilha Excel (CSV)
                    </button>

                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="py-4 px-4 rounded-2xl bg-slate-800 hover:bg-slate-900 text-white font-bold flex items-center justify-center gap-2 shadow transition"
                    >
                      <Printer className="w-5 h-5" />
                      Imprimir / Salvar em PDF
                    </button>
                  </div>

                  {/* Cartão da Chave de Recuperação de Emergência */}
                  <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border-2 border-amber-400 dark:border-amber-700 space-y-2">
                    <div className="flex items-center gap-2 font-extrabold text-amber-900 dark:text-amber-300">
                      <KeyRound className="w-5 h-5 text-amber-600" />
                      Cartão de Emergência Zero-Knowledge
                    </div>
                    <p className="text-xs text-amber-900/90 dark:text-amber-200 leading-relaxed">
                      Sua Chave de Emergência permite recuperar seus dados caso você esqueça sua senha, mantendo 100% de sigilo. Guarde-a anotada em local seguro:
                    </p>
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 font-mono font-extrabold text-center text-sm tracking-wider">
                      {newlyGeneratedKey || user.recoveryKeyHint || 'Consulte seu cartão físico de emergência'}
                    </div>
                  </div>
                </div>

                {/* Alteração de Senha, PIN de 4-6 dígitos e Chave de Emergência */}
                <form
                  onSubmit={handleUpdateSecurity}
                  className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 no-print"
                >
                  <h2 className="text-xl font-extrabold flex items-center gap-2">
                    <ShieldCheck className="w-6 h-6 text-emerald-600" />
                    Alterar Senha ou PIN de Bloqueio
                  </h2>

                  <div>
                    <label className="block text-sm font-bold mb-1">Senha Atual (Obrigatória)</label>
                    <input
                      type="password"
                      required
                      value={secCurrentPassword}
                      onChange={(e) => setSecCurrentPassword(e.target.value)}
                      placeholder="Digite sua senha atual"
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold mb-1">
                        Nova Senha Forte (Opcional)
                      </label>
                      <input
                        type="password"
                        value={secNewPassword}
                        onChange={(e) => setSecNewPassword(e.target.value)}
                        placeholder="Mín. 8 caracteres"
                        className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold mb-1">
                        Novo PIN Rápido (4 a 6 números)
                      </label>
                      <input
                        type="password"
                        maxLength={6}
                        value={secNewPin}
                        onChange={(e) => setSecNewPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="Ex: 1234"
                        className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2.5 text-sm font-semibold cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={secRegenRecovery}
                      onChange={(e) => setSecRegenRecovery(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-600"
                    />
                    <span>Gerar também uma nova Chave de Recuperação de Emergência</span>
                  </label>

                  <button
                    type="submit"
                    className="w-full py-3.5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold shadow-lg transition"
                  >
                    Atualizar Credenciais de Segurança
                  </button>
                </form>
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
};
