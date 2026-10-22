import React, { useState, useRef, useEffect } from 'react';
import { Lock, LogOut, ShieldAlert } from 'lucide-react';
import { LkLogo } from './LkLogo';
import { apiRequest } from '../services/api';

interface PinLockModalProps {
  userName: string;
  onUnlocked: () => void;
  onForceLogout: () => void;
}

export const PinLockModal: React.FC<PinLockModalProps> = ({
  userName,
  onUnlocked,
  onForceLogout,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleUnlock = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (pin.length < 4) {
      setError('Digite seu PIN de 4 a 6 números.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await apiRequest('/auth/unlock-pin', {
        method: 'POST',
        body: JSON.stringify({ pin }),
      });
      setPin('');
      onUnlocked();
    } catch (err: any) {
      setPin('');
      inputRef.current?.focus();
      if (err.forceRelogin) {
        onForceLogout();
        return;
      }
      setError(err.message || 'PIN incorreto.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-md p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border-2 border-emerald-600/40 rounded-3xl shadow-2xl p-6 sm:p-8 text-center">
        <div className="flex justify-center mb-4">
          <LkLogo size="lg" showText={true} subtitle="Cofre Protegido por PIN" />
        </div>

        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 text-sm font-semibold mb-3">
          <Lock className="w-4 h-4" />
          Tela Bloqueada por Segurança
        </div>

        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Olá, {userName}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 mb-5">
          Digite seu PIN numérico de 4 a 6 dígitos no teclado e pressione Enter.
        </p>

        <form onSubmit={handleUnlock} className="space-y-4">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoFocus
            maxLength={6}
            value={pin}
            onChange={(e) => {
              setError(null);
              setPin(e.target.value.replace(/\D/g, ''));
            }}
            placeholder="••••••"
            className="w-full py-4 px-6 rounded-2xl bg-slate-100 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 focus:border-emerald-500 focus:outline-none text-center text-3xl font-mono tracking-[0.5em] text-slate-900 dark:text-white"
          />

          {error && (
            <div className="flex items-center gap-2 text-left p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-medium">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || pin.length < 4}
            className="w-full py-4 rounded-2xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-lg shadow-lg transition"
          >
            {loading ? 'Desbloqueando Cofre...' : 'Desbloquear Tela (Enter)'}
          </button>
        </form>

        <button
          type="button"
          onClick={onForceLogout}
          className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition"
        >
          <LogOut className="w-4 h-4" />
          Sair e voltar para a tela de Senha
        </button>
      </div>
    </div>
  );
};
