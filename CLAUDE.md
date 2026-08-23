# Rubinot / LearnDesk

Painel de consulta e gestão de tutores. Frontend React no GitHub Pages, backend Express + SQLite
num container Docker.

---

## ⚠️ REGRAS — leia antes de mexer em qualquer coisa

### 1. O servidor `bred` hospeda OUTRO projeto em produção

O backend roda no host `bred` (`37.148.135.192`), que **também roda o Bredot** — um servidor de
Tibia (OTServ) com site, MariaDB e certbot. É produção de terceiro, com jogadores online.

**Nunca**, em nenhuma circunstância:

- Editar qualquer coisa em `/opt/bredot/**`
- Mexer nos containers `bredot-*` (`docker stop`, `restart`, `rm`, alterar compose)
- Tocar nas portas **80** e **443** — são do `bredot-web-1` e só aceitam tráfego da Cloudflare
- Alterar o nginx, o certbot ou os certificados do Bredot
- Rodar `docker compose down` sem `-f /opt/rubinot/docker-compose.yml` (sem o `-f`, o Docker
  pega o compose do diretório atual e você pode derrubar o stack errado)
- Remover entradas do `crontab` que não sejam as nossas (`mem-watch.sh` e `reload-edge` são deles)
- Alterar regras do `ufw` além da nossa `8443/tcp`

**Sempre** use o caminho explícito em comandos Docker:

```bash
sudo docker compose -f /opt/rubinot/docker-compose.yml <comando>
```

### 2. O que é nosso, e só nosso

Tudo do Rubinot vive em `/opt/rubinot`. Nada fora dali.

| Caminho | Dono | Papel |
|---|---|---|
| `/opt/rubinot/app/` | `rubideploy` | Código (`server.js`, `commandParser.js`, `package*.json`) |
| `/opt/rubinot/data/` | `bred` (uid 1000) | `rubinot.db` — **os dados; nunca apagar** |
| `/opt/rubinot/certs/` | `bred` | Certificado em uso pelo nginx |
| `/opt/rubinot/docker-compose.yml` | `bred` | **Não pode ser editável pelo `rubideploy`** (ver §4) |
| `/opt/rubinot/.env` | `bred`, `600` | Segredos — nunca commitar, nunca imprimir em log |
| `/opt/rubinot/.duckdns-token` | `bred`, `600` | Token do DNS, usado na renovação do certificado |

### 3. Não commitar segredos

`.env` e `.env.production` não vão pro git. O `VITE_API_URL` do build de produção vem do
**secret do GitHub**, não do arquivo — mudar o `.env.production` local não afeta o deploy.

### 4. Por que o `docker-compose.yml` não pertence ao `rubideploy`

O usuário de deploy tem `sudo` para exatamente três comandos, todos com o caminho literal do
compose (`/etc/sudoers.d/rubinot-deploy`). Se ele pudesse **editar** esse arquivo, bastaria
adicionar um volume montando `/` do host para virar root. Por isso o arquivo é do `bred`.

Pelo mesmo motivo: **nunca** adicionar `rubideploy` ao grupo `docker` — isso equivale a root.

---

## Arquitetura

```
Browser
  │
  ├─ https://victorcamposr.github.io/learndesk/     (GitHub Pages, build do Vite)
  │
  └─ https://backendcampin.duckdns.org:8443         (API)
        │
        └─ host bred → rubinot-proxy (nginx, TLS) → rubinot-api (Node 22) → SQLite
```

A porta é **8443** porque 80/443 pertencem ao Bredot. O certificado sai por DNS-01 no duckdns,
justamente para não precisar dessas portas.

### Frontend

- React 18 + Vite, arquivo único [src/App.jsx](src/App.jsx)
- `base: '/learndesk/'` no [vite.config.js](vite.config.js) — não mudar sem ajustar o GitHub Pages
- Toda chamada de rede passa por `apiFetch` → `fetchWithTimeout`. **Não use `fetch` direto**:
  sem timeout, uma queda do backend trava a tela em loading infinito (foi o que aconteceu em 08/2026)

### Backend

- Express 5 + better-sqlite3, arquivo único [server.js](server.js)
- Banco em `DATA_DIR` (no container: `/data/rubinot.db`)
- Auth por device token + apelido + senha bcrypt; primeiro dispositivo vira admin automaticamente
- `BOOTSTRAP_ADMIN` no `.env` define o admin inicial quando o banco está vazio

---

## Deploy

### Frontend — automático

Push em `main` que toque `src/**`, `public/**`, `index.html`, `vite.config.*` ou `package*.json`
dispara [deploy.yml](.github/workflows/deploy.yml). Usa o secret `VITE_API_URL`.

### Backend — manual

O deploy automático por SSH **não funciona** a partir dos runners do GitHub (ver §Problemas
conhecidos). Da sua máquina:

```bash
git archive HEAD | ssh bred 'tar x -C /opt/rubinot/app'
ssh bred 'sudo docker compose -f /opt/rubinot/docker-compose.yml build api \
          && sudo docker compose -f /opt/rubinot/docker-compose.yml up -d api'
```

Alterou só o `server.js` e não as dependências? Pode pular o `build`, mas ele é rápido (cache).

### Certificado

Renova sozinho pelo cron (dia 1º às 3h). Para forçar:

```bash
ssh bred '. /opt/rubinot/.duckdns-token && /opt/rubinot/cert.sh'
```

---

## Segurança

O backend é público, então isto **não é opcional**:

- CORS com allowlist explícita em `ALLOWED_ORIGINS` — só o GitHub Pages entra. Ao adicionar
  origem, lembre que `IS_PROD` depende de `github.io` estar na lista (define `Secure`/`SameSite=None` no cookie)
- Rate limit por rota (login 10/15min, IA 10/min) — não remover; o limite da IA protege sua conta do Gemini
- O nginx só expõe `/api/`; qualquer outro caminho é 404
- Container roda como não-root, filesystem read-only, `no-new-privileges`
- Limites de 256 MB / 0.35 CPU são deliberados: impedem que o Rubinot sufoque o servidor de OT.
  Consumo real é ~23 MB. **Não aumentar sem motivo medido.**

---

## Problemas conhecidos

### Banco de produção preso na Oracle

O `rubinot.db` com os dados reais ficou na VPS Oracle, que foi **desabilitada** em 18/08/2026 por
exceder o novo limite do Always Free (A1 caiu de 4 OCPU/24 GB para 2 OCPU/12 GB em 15/06/2026).
Instância desabilitada recusa toda operação, inclusive soltar o disco.

Existe o backup `rubinot-resgate` (boot volume, 150 GB, íntegro e protegido contra exclusão), mas
restaurá-lo exige 150 GB e a conta só tem 50 GB livres de 200 GB. **Destravar exige upgrade para
Pay As You Go** — conta Always Free não pode nem abrir chamado de suporte.

O backend subiu com banco vazio. Para restaurar quando destravar:

```bash
scp rubinot.db bred:/tmp/
ssh bred 'sudo docker compose -f /opt/rubinot/docker-compose.yml stop api \
          && cp /tmp/rubinot.db /opt/rubinot/data/rubinot.db \
          && sudo chown 1000:1000 /opt/rubinot/data/rubinot.db \
          && sudo docker compose -f /opt/rubinot/docker-compose.yml start api'
```

### Deploy do backend por CI não conecta

Conexões SSH dos runners do GitHub para o `bred` estabelecem o TCP, trocam alguns KB e travam:
ambos os lados ficam em `ppoll` esperando o outro, sem retransmissão e sem erro, até o
`LoginGraceTime` de 120s derrubar. Não é chave, permissão nem firewall — do IP do desenvolvedor a
mesma chave e o mesmo usuário funcionam na hora. É um problema no caminho de rede entre a Azure
(onde rodam os runners) e o provedor do `bred`.

Por isso o deploy do backend é manual. O usuário `rubideploy` e o `sudoers` continuam válidos e
funcionam a partir de qualquer rede que não tenha esse problema.

---

## Ambiente local

```bash
npm run dev     # Vite (5173) + API (3003) juntos
npm run server  # só a API
```

O `.env` local precisa de `GEMINI_API_KEY` e `ADMIN_PASSWORD`. Sem `ALLOWED_ORIGINS`
contendo `github.io`, o cookie entra em modo dev (`SameSite=Lax`), que é o correto em localhost.
