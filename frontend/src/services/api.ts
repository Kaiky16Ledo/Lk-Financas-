export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'TITULAR' | 'SUPORTE';
  fontSizePref: 'NORMAL' | 'LARGE';
  themePref: 'LIGHT' | 'DARK';
  recoveryKeyHint: string | null;
  pinLocked: boolean;
}

export interface AccountItem {
  id: string;
  name: string;
  institution: string;
  type: 'CHECKING' | 'SAVINGS' | 'CASH';
  balance: number;
  updatedAt: string;
}

export interface CreditCardItem {
  id: string;
  accountId: string | null;
  name: string;
  limit: number;
  monthInvoice: number;
  totalCommitted?: number;
  availableLimit: number;
  closingDay: number;
  dueDay: number;
  monthTransactions?: TransactionItem[];
  allCardTransactions?: TransactionItem[];
}

export interface InvestmentItem {
  id: string;
  name: string;
  institution: string;
  category: 'FIXED_INCOME' | 'SAVINGS' | 'PENSION' | 'PATRIMONY';
  principalAmount: number;
  currentValue: number;
  monthlyYield: number;
  profitAmount: number;
  updatedAt: string;
}

export interface CategoryItem {
  id: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  color: string;
  icon: string;
}

export interface TransactionItem {
  id: string;
  accountId: string | null;
  accountName: string | null;
  creditCardId: string | null;
  creditCardName: string | null;
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  installmentGroupId: string | null;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  description: string;
  amount: number;
  competenceDate: string;
  dueDate: string;
  status: 'PAID' | 'PENDING';
  isRecurring: boolean;
  installmentNumber: number;
  totalInstallments: number;
  isOverdue?: boolean;
}

export interface FinanceOverviewResponse {
  month: string;
  summary: {
    totalAccountsBalance: number;
    totalInvestmentsValue: number;
    totalPatrimony: number;
    totalMonthlyYield: number;
    monthIncome: number;
    monthExpensePaid: number;
    monthExpensePending: number;
    monthExpenseTotal: number;
    monthNetBalance: number;
    prevMonth?: string;
    prevMonthIncome?: number;
    prevMonthExpenseTotal?: number;
    expenseDiffAmount?: number;
    expenseDiffPct?: number | null;
    incomeDiffAmount?: number;
    incomeDiffPct?: number | null;
  };
  accounts: AccountItem[];
  creditCards: CreditCardItem[];
  investments: InvestmentItem[];
  categories: CategoryItem[];
  transactions: TransactionItem[];
  upcomingAlerts: TransactionItem[];
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  const response = await fetch(`/api${endpoint}`, {
    ...options,
    credentials: 'include', // Envia e recebe apenas Cookie HttpOnly (protegido contra XSS)
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(data.error || 'Ocorreu um erro na comunicação com o servidor.') as Error & {
      status?: number;
      pinLocked?: boolean;
      forceRelogin?: boolean;
    };
    err.status = response.status;
    err.pinLocked = data.pinLocked;
    err.forceRelogin = data.forceRelogin;
    throw err;
  }

  return data as T;
}

export function formatCurrency(value: number, hidden = false): string {
  if (hidden) return 'R$ ••••••';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0);
}

export function formatDateBR(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
