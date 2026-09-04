# Nutri+

Sistema para acompanhamento nutricional de pacientes e nutricionistas, executável localmente ou em servidor. A única base alimentar ativa é a TACO 4ª edição ampliada e revisada, com 597 alimentos e 26 componentes por 100 g.

## Organização

- `frontend/`: interface web responsiva, porta 3000;
- `backend/`: API, banco PostgreSQL local, importador e regras nutricionais, porta 3001;
- `backend/data/taco/`: PDF oficial, JSON e CSV auditáveis;
- `docs/`: arquitetura e relatório da extração TACO.

## Inicialização

No Windows, abra `INICIAR_NUTRI.cmd`. O inicializador prepara o banco quando necessário, abre os serviços e acessa `https://localhost:3000`.

Também é possível usar:

```powershell
npm run db:setup
npm run dev
```

Na mesma rede local, o celular pode acessar `https://192.168.1.31:3000` enquanto o inicializador estiver aberto, o certificado local estiver instalado e o firewall permitir conexões locais.

## Acesso dos pacientes e e-mails

- o nutricionista cria o prontuário e recebe um código de ativação válido por 7 dias;
- o paciente usa o código uma vez, cadastra o próprio e-mail e cria a própria senha;
- a conta é liberada somente depois da confirmação do e-mail;
- o nutricionista pode reenviar a confirmação ou enviar uma restauração de senha;
- links de confirmação expiram em 24 horas e links de restauração em 1 hora;
- cada novo código ou link invalida o anterior da mesma finalidade.

Para enviar mensagens reais, copie as variáveis `NUTRI_SMTP_*` e `NUTRI_EMAIL_FROM` do `.env.example` para `.env.local`. O Amazon SES pode ser usado com suas credenciais SMTP. Sem essa configuração, o sistema permanece funcional e mostra o link local de teste na própria tela.

## Administração dos nutricionistas

A área administrativa local é acessada com `admin@local.test` e a senha inicial `Admin123!`. Ela cadastra e controla somente contas profissionais, sem listar, consultar, contar, transferir ou modificar pacientes e dados clínicos.

O administrador gera um código de ativação para o nutricionista, acompanha a confirmação do e-mail, envia restauração de senha e pode suspender ou reativar o acesso profissional. Pacientes permanecem vinculados exclusivamente ao nutricionista que os cadastrou.

## Comandos

```powershell
npm run taco:extract  # recria JSON e CSV a partir do PDF oficial
npm run taco:import   # UPSERT idempotente dos 597 alimentos
npm run db:setup      # migração, importação TACO e dados locais de demonstração
npm run audit         # contagens e invariantes do PostgreSQL
npm test              # testes do backend
npm run build         # validação de produção do frontend
```

## Execução portátil com Docker

O banco, a API e o frontend podem ser executados sem instalar suas dependências diretamente na máquina:

1. copie `.env.docker.example` para `.env`;
2. defina uma senha forte em `POSTGRES_PASSWORD` (codifique caracteres especiais para uso em URL);
3. execute `docker compose up --build`;
4. acesse `http://localhost:8080`.

O PostgreSQL fica em um volume persistente. `docker compose down` para os serviços sem apagar os dados; não use a opção `--volumes` sem ter um backup confirmado.

Em qualquer ambiente, o endereço do PostgreSQL fica somente em `DATABASE_URL`. Consulte `docs/ARCHITECTURE.md` para as proteções de conexão e a rotina de backup.

## Política nutricional

- todos os valores são por 100 g e escalados por uma única regra no backend;
- `Tr` permanece traço e nunca vira zero;
- `NA`, `*` e células vazias permanecem indisponíveis;
- zero numérico continua sendo zero real;
- kcal e kJ são campos independentes da tabela;
- os totais de refeições, dias e períodos usam a mesma função centralizada;
- a API é a única camada que acessa o PostgreSQL; nenhuma credencial é armazenada no Git.

Detalhes: [arquitetura](docs/ARCHITECTURE.md) e [relatório da TACO](docs/TACO_EXTRACTION_REPORT.md).
