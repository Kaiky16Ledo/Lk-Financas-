# 🛡️ LK Finanças — Cofre Pessoal Seguro (Zero-Knowledge)

Sistema completo de gestão financeira pessoal e patrimonial desenvolvido especialmente para o seu pai, com identidade visual **LK**, acessível pelo **celular (PWA instalável)** e pelo **computador**, protegido por criptografia **AES-256-GCM + scrypt (Envelope Encryption)**, banco **SQLite nativo em modo WAL** e segregação **Zero-Knowledge**.

---

## 🔐 Credenciais de Primeiro Acesso (Geradas com Segurança)

Por segurança de produção, **nenhuma senha ou PIN fica exposta na tela de login nem nos logs do terminal**.

Na primeira vez que o servidor inicia e cria o banco `backend/data/lk_vault.sqlite`, ele gera senhas aleatórias fortes, o PIN inicial e a Chave de Recuperação de Emergência no arquivo:

👉 **`backend/data/PRIMEIRO_ACESSO.txt`**

1. Abra `backend/data/PRIMEIRO_ACESSO.txt`, anote as credenciais iniciais do **Titular (`pai@financas.familia`)** e do **Suporte (`suporte@financas.familia`)** e guarde a **Chave de Recuperação de Emergência**.
2. Em seguida, **apague o arquivo `PRIMEIRO_ACESSO.txt`** e altere a senha/PIN na aba **5. Relatórios & Segurança** dentro do painel do titular.

---

## 🚀 Como Executar no Seu Computador

1. Instale as dependências (caso ainda não tenha instalado):
   ```powershell
   npm run install:all
   ```

2. Inicie o **Backend** (Porta `4000`):
   ```powershell
   npm run dev:backend
   ```

3. Em outro terminal, inicie o **Frontend** (Porta `5173`):
   ```powershell
   npm run dev:frontend
   ```

4. Acesse no navegador: **`http://localhost:5173`**

---

## ☁️ Como Hospedar na Nuvem (Render, Railway, Fly.io ou VPS com Docker)

O projeto inclui um [Dockerfile](./Dockerfile) multi-stage (`node:24-alpine` com `node:sqlite` nativo) e [docker-compose.yml](./docker-compose.yml):

```bash
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
docker compose up -d --build
```
