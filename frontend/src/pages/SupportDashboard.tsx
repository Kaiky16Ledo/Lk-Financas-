import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Unlock,
  KeyRound,
  Download,
  RefreshCw,
  LogOut,
  Lock,
  Database,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import { LkLogo } from '../components/LkLogo';
import { apiRequest, UserProfile } from '../services/api';

interface SupportDashboardProps {
  user: UserProfile;
  onLogout: () => void;
}

interface SupportDataResponse {
  titularStatus: {
    id: string;
    name: string;
    email: string;
    isLocked: boolean;
    lockedUntil: string | null;
    failedLoginAttempts: number;
    failedPinAttempts: number;
    resetAuthorizedBySupport: boolean;
    recoveryKeyHint: string | null;
    wrappedDekPreview: string | null;
  };
  vaultStats: {
    encryptedAccountsCount: number;
    encryptedCardsCount: number;
    encryptedInvestmentsCount: number;
    encryptedTransactionsCount: number;
    auditLogsCount: number;
  };
  encryptedSamples: Array<{
    table: string;
    recordId: string;
    encryptedName: string;
    encryptedValue: string;
  }>;
  auditLogs: Array<{
    id: string;
    actor_role: string;
    action: string;
    details: string;
    ip_address: string;
    user_agent: string;
    created_at: string;
  }>;
}

export const SupportDashboard: React.FC<SupportDashboardProps> = ({ user, onLogout }) => {
  const [data, setData] = useState<SupportDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<SupportDataResponse>('/support/dashboard');
      setData(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const showMessage = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  };

  const handleUnlockTitular = async () => {
    const res = await apiRequest<{ message: string }>('/support/unlock-titular', {
      method: 'POST',
    });
    showMessage(res.message);
    loadDashboard();
  };

  const handleToggleResetAuth = async (authorize: boolean) => {
    const res = await apiRequest<{ message: string }>('/support/toggle-reset-authorization', {
      method: 'POST',
      body: JSON.stringify({ authorize }),
    });
    showMessage(res.message);
    loadDashboard();
  };

  const handleDownloadBackup = async () => {
    const res = await fetch('/api/support/encrypted-backup', {
      credentials: 'include',
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lk-financas-backup-cifrado-${new Date().toISOString().slice(0, 10)}.enc.json`;
    a.click();
    URL.revokeObjectURL(url);
    showMessage('Backup criptografado (.enc.json) baixado com sucesso!');
    loadDashboard();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <LkLogo
            size="md"
            showText={true}
            subtitle="Console Técnico de Suporte • Segregação Zero-Knowledge"
          />

          <div className="flex items-center gap-3">
            <span className="px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold">
              🛠️ {user.name}
            </span>
            <button
              type="button"
              onClick={loadDashboard}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 transition"
              title="Atualizar diagnóstico"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600/20 hover:bg-red-600/30 border border-red-700 text-red-300 text-sm font-bold transition"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 pt-6 space-y-6">
        {toast && (
          <div className="p-4 rounded-2xl bg-emerald-600 text-white font-bold flex items-center gap-2 shadow-lg">
            <CheckCircle2 className="w-5 h-5" />
            <span>{toast}</span>
          </div>
        )}

        {/* Banner de Garantia Arquitetural Zero-Knowledge */}
        <section className="p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-emerald-950/60 to-slate-900 border border-emerald-700/50 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 max-w-3xl">
              <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-400">
                <Lock className="w-4 h-4" />
                Isolamento Criptográfico Zero-Knowledge Ativo
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-white">
                Painel de Suporte Técnico Familiar (Sem Acesso a Saldos ou Valores)
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed">
                Esta conta permite ajudar seu pai a <strong>destravar o login</strong>,{' '}
                <strong>autorizar recuperação de senha</strong> e <strong>fazer backups</strong>, mas
                não possui a Chave de Dados (DEK) dele. Todos os saldos e lançamentos permanecem
                100% ilegíveis em <code className="font-mono text-amber-300">AES-256-GCM</code>.
              </p>
            </div>

            <button
              type="button"
              onClick={handleDownloadBackup}
              className="px-5 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm shadow-lg inline-flex items-center gap-2 transition"
            >
              <Download className="w-5 h-5" />
              Baixar Backup Criptografado (.enc)
            </button>
          </div>
        </section>

        {loading || !data ? (
          <div className="p-12 text-center text-slate-400 font-bold">
            Carregando telemetria de segurança...
          </div>
        ) : (
          <>
            {/* Status da Conta do Pai e Ações Rápidas de Suporte */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 space-y-5">
                <h2 className="text-lg font-extrabold flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  Status da Conta do Titular (Seu Pai)
                </h2>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-4 rounded-2xl bg-slate-800/70 border border-slate-700">
                    <div className="text-xs text-slate-400">E-mail do Titular</div>
                    <div className="font-bold mt-1">{data.titularStatus.email}</div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-800/70 border border-slate-700">
                    <div className="text-xs text-slate-400">Situação de Acesso</div>
                    <div className="font-bold mt-1">
                      {data.titularStatus.isLocked ? (
                        <span className="text-red-400">🔒 Bloqueada por Tentativas</span>
                      ) : (
                        <span className="text-emerald-400">✅ Ativa e Normal</span>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-800/70 border border-slate-700">
                    <div className="text-xs text-slate-400">Erros de Senha / PIN</div>
                    <div className="font-bold mt-1">
                      Senha: {data.titularStatus.failedLoginAttempts}/5 • PIN:{' '}
                      {data.titularStatus.failedPinAttempts}/3
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-800/70 border border-slate-700">
                    <div className="text-xs text-slate-400">Dica da Chave de Emergência</div>
                    <div className="font-mono font-bold text-amber-300 mt-1 text-xs">
                      {data.titularStatus.recoveryKeyHint}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleUnlockTitular}
                    className="flex-1 py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-600 font-bold text-sm inline-flex items-center justify-center gap-2 transition"
                  >
                    <Unlock className="w-4 h-4 text-emerald-400" />
                    Zerar Tentativas / Destravar Conta
                  </button>

                  {!data.titularStatus.resetAuthorizedBySupport ? (
                    <button
                      type="button"
                      onClick={() => handleToggleResetAuth(true)}
                      className="flex-1 py-3.5 px-4 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm inline-flex items-center justify-center gap-2 transition"
                    >
                      <KeyRound className="w-4 h-4" />
                      Autorizar Troca de Senha (Emergência)
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleToggleResetAuth(false)}
                      className="flex-1 py-3.5 px-4 rounded-2xl bg-red-700 hover:bg-red-600 text-white font-bold text-sm inline-flex items-center justify-center gap-2 transition"
                    >
                      <ShieldAlert className="w-4 h-4" />
                      Cancelar Autorização de Troca
                    </button>
                  )}
                </div>
              </div>

              {/* Prova Criptográfica Zero-Knowledge (Inspeção de Registros Cifrados) */}
              <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-extrabold flex items-center gap-2">
                    <Database className="w-5 h-5 text-amber-400" />
                    Inspeção do Banco Criptografado (Zero-Knowledge)
                  </h2>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700 font-mono">
                    AES-256-GCM
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Abaixo estão exemplos reais de como os dados do seu pai estão gravados no banco de dados. Sem a senha ou PIN dele, nenhum valor pode ser lido:
                </p>

                <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                  {data.encryptedSamples.map((sample, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs space-y-1"
                    >
                      <div className="text-emerald-400 font-bold">
                        Tabela: {sample.table} (ID #{sample.recordId})
                      </div>
                      <div className="text-slate-400 truncate">
                        Descrição: <span className="text-slate-300">{sample.encryptedName}</span>
                      </div>
                      <div className="text-slate-400 truncate">
                        Valor/Saldo: <span className="text-amber-300">{sample.encryptedValue}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Trilha de Auditoria (Audit Logs) */}
            <section className="bg-slate-900 p-6 rounded-3xl border border-slate-800 space-y-4">
              <h2 className="text-lg font-extrabold flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-400" />
                Histórico de Segurança e Acessos (Audit Logs)
              </h2>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase">
                      <th className="py-3 px-3">Data / Hora</th>
                      <th className="py-3 px-3">Perfil</th>
                      <th className="py-3 px-3">Evento</th>
                      <th className="py-3 px-3">Detalhes</th>
                      <th className="py-3 px-3">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {data.auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-800/40">
                        <td className="py-3 px-3 font-mono text-xs text-slate-400 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-bold ${
                              log.actor_role === 'TITULAR'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : log.actor_role === 'SUPORTE'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-red-950 text-red-300'
                            }`}
                          >
                            {log.actor_role}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs font-bold text-white">
                          {log.action}
                        </td>
                        <td className="py-3 px-3 text-slate-300">{log.details}</td>
                        <td className="py-3 px-3 font-mono text-xs text-slate-400">
                          {log.ip_address}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};
