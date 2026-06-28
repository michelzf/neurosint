# `apps/mobile/` — app Neurosint (Expo / React Native) · Fase F4

App nativo-ready (iOS + Android) e **executável em web** (React Native Web), reaproveitando os
mesmos endpoints do backend. Slice v1: **Login → Caso → Perguntar (resposta + alerta) → Linha do
tempo**. Upload de exame entra na v2 (precisa de `expo-document-picker`).

## Arquitetura
- `App.tsx` — telas (uma tela com seções condicionais; sem lib de navegação ainda).
- `src/api.ts` — `fetch` puro (web + nativo) para `auth`/`rest`/`functions`. Base configurável:
  `globalThis.NEUROSINT_BASE` (default `http://127.0.0.1:8000` = dev-server local). Em produção,
  aponte para a URL do projeto Supabase hospedado.

## Rodar (web, para testar local)
Precisa do **dev-server no ar** (`pwsh tools/local-dev.ps1` → `:8000`, preset echo).

```bash
cd apps/mobile
npx expo install react-dom react-native-web @expo/metro-runtime   # uma vez (deps de web)
npx expo start --web
# login dev: cuidador@dev.local / neurosint-dev
```

> O dev-server (`tools/devkit/server.ts`) responde com CORS, então o app web (noutra porta)
> consegue chamar `:8000`.

## Rodar (nativo)
`npx expo start` e abra no Expo Go (ou emulador). No celular físico, troque `NEUROSINT_BASE` para
o IP da máquina (ou para o projeto hospedado) — `127.0.0.1` no aparelho aponta para ele mesmo.

## Próximos (F4)
Navegação (expo-router), `expo-secure-store` para o token, upload de exame (`expo-document-picker`),
push (`expo-notifications`), e as telas de membros/convite e visão do médico.
