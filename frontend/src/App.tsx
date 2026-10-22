import React, { useState, useEffect } from 'react';
import { LoginPage } from './pages/LoginPage';
import { TitularDashboard } from './pages/TitularDashboard';
import { SupportDashboard } from './pages/SupportDashboard';
import { PinLockModal } from './components/PinLockModal';
import { apiRequest, UserProfile } from './services/api';

export const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [fontSize, setFontSize] = useState<'NORMAL' | 'LARGE'>('LARGE');
  const [theme, setTheme] = useState<'LIGHT' | 'DARK'>('DARK');
  const [pinLocked, setPinLocked] = useState(false);

  // Aplica classes globais de Acessibilidade e mantém Modo Escuro fixo
  useEffect(() => {
    const html = document.documentElement;
    if (fontSize === 'LARGE') {
      html.classList.add('font-large');
      html.classList.remove('font-normal');
    } else {
      html.classList.add('font-normal');
      html.classList.remove('font-large');
    }
  }, [fontSize]);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, [theme]);

  // Verifica se já existe sessão ativa (Cookie HttpOnly) ao abrir o app
  useEffect(() => {
    apiRequest<{ user: UserProfile }>('/auth/me')
      .then((res) => {
        setUser(res.user);
        setFontSize(res.user.fontSizePref || 'LARGE');
        setTheme('DARK');
        setPinLocked(Boolean(res.user.pinLocked));
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setInitializing(false);
      });
  }, []);

  const handleLoginSuccess = (loggedUser: UserProfile) => {
    setUser(loggedUser);
    setFontSize(loggedUser.fontSizePref || 'LARGE');
    setTheme('DARK');
    setPinLocked(Boolean(loggedUser.pinLocked));
  };

  const handleToggleFontSize = () => {
    const next = fontSize === 'LARGE' ? 'NORMAL' : 'LARGE';
    setFontSize(next);
    if (user) {
      apiRequest('/auth/preferences', {
        method: 'PUT',
        body: JSON.stringify({ fontSizePref: next }),
      }).catch(() => {});
    }
  };

  const handleToggleTheme = () => {
    const next = theme === 'DARK' ? 'LIGHT' : 'DARK';
    setTheme(next);
    if (user) {
      apiRequest('/auth/preferences', {
        method: 'PUT',
        body: JSON.stringify({ themePref: next }),
      }).catch(() => {});
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignora erro caso já tenha expirado
    }
    setUser(null);
    setPinLocked(false);
  };

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white font-bold">
        Iniciando Cofre Seguro LK Finanças...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        onLoginSuccess={handleLoginSuccess}
        fontSize={fontSize}
        onToggleFontSize={handleToggleFontSize}
      />
    );
  }

  if (user.role === 'SUPORTE') {
    return <SupportDashboard user={user} onLogout={handleLogout} />;
  }

  return (
    <>
      {pinLocked && (
        <PinLockModal
          userName={user.name}
          onUnlocked={() => setPinLocked(false)}
          onForceLogout={handleLogout}
        />
      )}
      <TitularDashboard
        user={user}
        fontSize={fontSize}
        theme={theme}
        onToggleFontSize={handleToggleFontSize}
        onToggleTheme={handleToggleTheme}
        onPinLocked={() => setPinLocked(true)}
        onLogout={handleLogout}
      />
    </>
  );
};
