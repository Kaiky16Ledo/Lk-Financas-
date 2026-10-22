import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Lock,
  Mail,
  Eye,
  EyeOff,
  KeyRound,
  UserCheck,
  Wrench,
  AlertCircle,
  CheckCircle2,
  Type,
} from 'lucide-react';
import { LkLogo } from '../components/LkLogo';
import { apiRequest, UserProfile } from '../services/api';

interface LoginPageProps {
  onLoginSuccess: (user: UserProfile) => void;
  fontSize: 'NORMAL' | 'LARGE';
  onToggleFontSize: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginSuccess,
  fontSize,
  onToggleFontSize,
}) => {
  const [email, setEmail] = useState('pai@financas.familia');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado do Modal de Recuperação Zero-Knowledge (Chave de Emergência)
  const [showRecovery, setShowRecovery] = useState(false);
  const [resetAuthorized, setResetAuthorized] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [recoverySuccess, setRecoverySuccess] = useState<string | null>(null);

  useEffect(() => {
    if (showRecovery) {
      apiRequest<{ resetAuthorizedBySupport: boolean }>('/auth/recovery-status')
        .then((res) => {
          setResetAuthorized(res.resetAuthorizedBySupport);
        })
        .catch(() => {});
    }
  }, [showRecovery]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await apiRequest<{ user: UserProfile }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onLoginSuccess(response.user);
    } catch (err: any) {
      setError(err.message || 'Falha ao realizar login.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setRecoverySuccess(null);

    try {
      const res = await apiRequest<{ message: string }>('/auth/recover-password', {
        method: 'POST',
        body: JSON.stringify({
          recoveryKey: recoveryKeyInput,
          newPassword,
          newPin,
        }),
      });
      setRecoverySuccess(res.message);
      setPassword('');
      setTimeout(() => {
        setShowRecovery(false);
        setRecoverySuccess(null);
      }, 2500);
    } catch (err: any) {
      setError(err.message || 'Erro ao recuperar senha.');
    } finally {
      setLoading(false);
    }
  };

  const selectPresetProfile = (role: 'TITULAR' | 'SUPORTE') => {
    setError(null);
    setPassword('');
    if (role === 'TITULAR') {
      setEmail('pai@financas.familia');
    } else {
      setEmail('suporte@financas.familia');
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-950 text-slate-100 p-4 sm:p-6">
      {/* Barra de Topo com Logo LK */}
      <header className="max-w-5xl w-full mx-auto flex flex-wrap items-center justify-between gap-4 py-2">
        <LkLogo size="md" showText={true} subtitle="Sistema Fechado • Criptografia AES-256-GCM" />
      </header>

      {/* Card Central de Autenticação */}
      <main className="w-full max-w-lg mx-auto my-6">
        <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-3xl shadow-2xl border-2 border-emerald-600/40 p-6 sm:p-9">
          <div className="flex flex-col items-center text-center mb-6">
            <LkLogo size="xl" showText={false} />
            <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              LK Finanças
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Acesso exclusivo e protegido por criptografia ponta a ponta
            </p>
          </div>

          {/* Seletor Rápido de Perfil (Titular vs Suporte) */}
          <div className="grid grid-cols-2 gap-3 mb-6 p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => selectPresetProfile('TITULAR')}
              className={`flex items-center justify-center gap-2 py-3 px-3 rounded-xl font-bold text-sm transition ${
                email === 'pai@financas.familia'
                  ? 'bg-emerald-700 text-white shadow-md'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/50'
              }`}
            >
              <UserCheck className="w-4 h-4 shrink-0" />
              <span>Acesso</span>
            </button>

            <button
              type="button"
              onClick={() => selectPresetProfile('SUPORTE')}
              className={`flex items-center justify-center gap-2 py-3 px-3 rounded-xl font-bold text-sm transition ${
                email === 'suporte@financas.familia'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/50'
              }`}
            >
              <Wrench className="w-4 h-4 shrink-0" />
              <span>Suporte</span>
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-3 p-4 mb-5 rounded-2xl bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 text-sm font-medium">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {recoverySuccess && (
            <div className="flex items-start gap-3 p-4 mb-5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm font-semibold">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600" />
              <span>{recoverySuccess}</span>
            </div>
          )}

          {!showRecovery ? (
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                  E-mail de Acesso
                </label>
                <div className="relative">
                  <Mail className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="pai@financas.familia"
                    className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                  Senha de Segurança
                </label>
                <div className="relative">
                  <Lock className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Digite sua senha segura"
                    className="w-full pl-12 pr-24 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 inline-flex items-center gap-1"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    {showPassword ? 'Ocultar' : 'Ver'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 rounded-2xl bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:opacity-50 text-white font-extrabold text-lg shadow-lg transition flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-6 h-6" />
                {loading ? 'Descriptografando Cofre...' : 'Entrar no Sistema LK'}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setShowRecovery(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  <KeyRound className="w-4 h-4" />
                  Esqueceu a senha? Recuperar com Chave de Emergência
                </button>
              </div>
            </form>
          ) : (
            /* Formulário de Recuperação Zero-Knowledge */
            <form onSubmit={handleRecoverySubmit} className="space-y-4">
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-sm">
                <div className="font-bold mb-1">Recuperação Zero-Knowledge (Sem perda de dados)</div>
                <p className="text-xs leading-relaxed">
                  1. O perfil de <strong>Suporte</strong> deve autorizar a troca no painel técnico.
                  <br />
                  2. Digite sua <strong>Chave de Emergência de 24 caracteres</strong> para re-encapsular seu cofre com uma nova senha.
                </p>
                <div className="mt-2 font-bold text-xs">
                  Status da Autorização do Suporte:{' '}
                  {resetAuthorized ? (
                    <span className="text-emerald-700 dark:text-emerald-400">✅ AUTORIZADO</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">
                      🔒 AGUARDANDO LIBERAÇÃO DO SUPORTE
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold mb-1">
                  Chave de Recuperação de Emergência
                </label>
                <input
                  type="text"
                  required
                  value={recoveryKeyInput}
                  onChange={(e) => setRecoveryKeyInput(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono uppercase text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold mb-1">Nova Senha Forte</label>
                  <input
                    type="password"
                    required
                    minLength={10}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 10 caracteres"
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">Novo PIN (4-6 números)</label>
                  <input
                    type="password"
                    required
                    maxLength={6}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="Ex: 1234"
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono text-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold shadow-lg transition"
              >
                {loading ? 'Restaurando Cofre...' : 'Redefinir Senha e Preservar Dados'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setShowRecovery(false);
                }}
                className="w-full py-2.5 text-sm font-bold text-slate-600 dark:text-slate-400 hover:underline"
              >
                Voltar para o Login
              </button>
            </form>
          )}
        </div>
      </main>

      <footer className="text-center text-xs text-slate-400 py-2">
        LK Finanças • Protegido com Criptografia Militar AES-256-GCM • Sem Cadastro Público
      </footer>
    </div>
  );
};
