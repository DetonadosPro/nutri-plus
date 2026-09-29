# Reconhecimento de alimentos por imagem

O Nutri+ permite que uma pessoa usuária envie uma foto de uma refeição e revise os alimentos sugeridos antes de registrá-los. A identificação visual retorna candidatos estruturados; o backend relaciona os candidatos ao catálogo alimentar e às informações nutricionais locais. A confirmação da pessoa usuária é necessária antes do registro.

## Provedores

O serviço oferece adaptadores para Ollama, Gemini, OpenAI Responses e APIs compatíveis com a API OpenAI. O provedor e o modelo são definidos pela configuração do ambiente. O repositório não determina qual provedor está ativo em uma implantação específica.

As imagens enviadas para reconhecimento podem ser transmitidas ao provedor configurado. Antes de habilitar um provedor externo, avalie suas regras de tratamento e retenção de dados e informe as pessoas usuárias. Não inclua fotografias de pacientes, capturas de telas com dados pessoais, tokens ou credenciais neste repositório.

## Catálogo e confirmação

Após a identificação visual, o backend faz a correspondência com o catálogo alimentar ativo baseado na TBCA. O serviço de visão não atribui nutrientes, quantidades ou identificadores do catálogo. A pessoa usuária revisa as sugestões e confirma os itens e as quantidades; correspondências incertas podem exigir seleção manual.

## Demonstrações e testes

Use somente imagens sintéticas ou imagens para as quais exista autorização explícita de uso. Demonstrações públicas não devem conter nomes, dados de saúde, dados de clientes ou telas de contas reais. Armazene credenciais e arquivos de configuração locais fora do controle de versão; os arquivos `.env.example` servem apenas como modelos.

Consulte o código em `services/food-vision/`, os tipos compartilhados de reconhecimento e os testes para detalhes da implementação. A configuração de desenvolvimento deve ser feita no próprio ambiente local, sem publicar caminhos de máquina, comandos de servidores ou informações de implantação.
