# Segurança de produção na AWS

O Nutri+ usa Lightsail em sa-east-1, PostgreSQL na própria instância, Nginx, PM2, SES por SMTP e backups no S3. RDS continua adiado.

## Secrets Manager e identidade da aplicação

O segredo `nutriplus/production/application` contém somente `DATABASE_URL`, `NUTRI_SMTP_USER` e `NUTRI_SMTP_PASSWORD`. A aplicação busca os valores uma vez, antes de construir o pool PostgreSQL e o transporte SMTP. Se a leitura falhar, a inicialização falha sem recorrer a credenciais antigas.

A role `nutriplus-application-secrets` permite apenas `secretsmanager:GetSecretValue` no ARN exato desse segredo. O perfil AWS `nutriplus-app` assume essa role usando o perfil `default` já existente no servidor. As credenciais da role duram uma hora e o provedor do SDK administra sua renovação. Nenhuma nova access key foi criada.

Isso não elimina a chave persistente de origem: ela continua sendo usada pela identidade de backup e para assumir a role. Não aplicar a instrução de anexar um instance profile EC2 ao Lightsail. O SDK recebe o perfil por `AWS_PROFILE`; não copiar chaves para o código ou para o frontend.

O script `deploy/aws/provision-secrets.py` exige uma identidade administrativa, verifica a conta e prepara o segredo e políticas limitadas. Ele concede temporariamente `PutSecretValue` à identidade de origem para a carga inicial. Remover a política `TemporaryNutriPlusSecretProvisioning` imediatamente após a transferência e verificação dos valores. O script não contém valores secretos e não deve ser executado pela aplicação.

Configuração não secreta no ambiente de produção:

```dotenv
NUTRI_ENV=production
NODE_ENV=production
NUTRI_APP_URL=https://nutriplusapp.store
NUTRI_API_HOST=127.0.0.1
NUTRI_AWS_SECRET_ID=nutriplus/production/application
AWS_REGION=sa-east-1
AWS_PROFILE=nutriplus-app
NUTRI_ALLOW_EMAIL_PREVIEW=false
NUTRI_ALLOW_DEMO_SEED=false
```

`NUTRI_RELEASE` identifica o commit publicado em `/api/health`. Host/porta SMTP, remetente e resposta continuam na configuração não secreta.

## Senhas, sessões e convites

- Senhas continuam como hashes scrypt; processamento agora assíncrono e compatível com os hashes anteriores.
- Cookies de produção usam Secure, HttpOnly e SameSite=strict.
- Respostas da API usam no-store. O Nginx aplica HSTS, no-referrer, nosniff e bloqueio de enquadramento.
- Somente o proxy local é confiável para determinar IP; o Nginx sobrescreve X-Forwarded-For com o endereço do cliente.
- Login, ativação, identificação e consumo de tokens têm limites por IP e, quando informado, e-mail normalizado. Solicitações profissionais de e-mail/código também são limitadas. O armazenamento dos contadores é em memória, adequado ao processo único atual; ao escalar para múltiplas instâncias, usar um armazenamento compartilhado.
- Em produção, falhas de envio nunca devolvem links de confirmação ou recuperação. A interface informa a falha e permite ao responsável reenviar.
- Consumo de tokens e atualização da conta ocorrem na mesma transação. Emissão e consumo serializam pelo usuário; apenas um consumidor simultâneo pode usar o token.
- Administração é rejeitada explicitamente pelo acesso clínico compartilhado. A área administrativa continua limitada aos profissionais.
- O seed de demonstração exige ambiente local e `NUTRI_ALLOW_DEMO_SEED=true`. Não executar `db:setup` em produção.

## SES e rotação

O envio continua por SMTP SES, com TLS obrigatório e limites de tempo. A aprovação da saída do sandbox é independente dessas mudanças. O uso da API SES pode ser considerado futuramente; credenciais temporárias não são aceitas pelo transporte SMTP.

A rotação automática do PostgreSQL autogerenciado não foi ativada. Ao trocar uma senha, coordenar banco/SMTP, versão do segredo e reinicialização da aplicação; os valores já carregados permanecem em memória até o reinício. Validar uma instância candidata antes de trocar o serviço ativo.

O backup usa configuração própria em `/home/ubuntu/.config/nutriplus/backup.env`, com sua credencial de banco e o perfil AWS default. Ela foi preservada para não interromper o backup. Incluir essa configuração em qualquer futura rotação da senha do banco. Cópias de rollback da configuração também devem ser tratadas como segredos.

## Verificação

`npm test` executa os testes de domínio e segurança. Para os testes concorrentes de PostgreSQL, executar com `NUTRI_RUN_DB_SECURITY_TESTS=true` em ambiente local. Eles criam um schema exclusivo, executam as migrações e removem somente esse schema ao terminar; são bloqueados para produção, banco remoto ou Secrets Manager configurado.

Validar release pública, cookie, limites, isolamento de perfis, conservação dos históricos e backup depois da publicação. Testes de envio não devem disparar e-mails reais sem autorização.

Esta implementação não equivale a auditoria integral da conta AWS, teste de invasão ou correção de todos os avisos de dependências. A verificação de pacotes indicou avisos em dependências legadas; atualizações amplas do frontend e do transporte de e-mail exigem validação própria.
