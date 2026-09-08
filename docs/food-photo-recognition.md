# Reconhecimento de alimentos por foto

## Escolha do modelo

Referências verificadas em 08/09/2026:

| Modelo | Artefato Ollama | Licença | Decisão |
| --- | --- | --- | --- |
| Qwen3-VL 4B Instruct Q4_K_M | 3,3 GB | Apache 2.0 | Primeira opção para teste local |
| Qwen3-VL 2B | 1,9 GB | Conferir licença da tag antes da troca | Alternativa se o 4B ficar lento |
| Gemma 3 4B | 3,3 GB | Termos Gemma | Alternativa, sem vantagem comprovada neste prato/hardware |

Fontes: https://ollama.com/library/qwen3-vl:4b-instruct, https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct, https://ollama.com/library/qwen3-vl/tags, https://ollama.com/library/gemma3, https://docs.ollama.com/capabilities/structured-outputs.

O tamanho do download NÃO representa VRAM total. A máquina verificada tem RTX 3050 Laptop 6144 MiB. O teste real retornou `100% GPU`, mas o Windows mostrou 5,5/6 GB de VRAM dedicada e 0,7 GB compartilhada em uso no conjunto do sistema. Contexto 4096, imagem de no máximo 1024px e apenas uma análise simultânea limitam o consumo. O gateway usa `keep_alive: 0` para descarregar o modelo após cada resposta; a próxima foto será mais lenta por recarregá-lo. O usuário pediu para realizar pessoalmente a instalação e configuração da máquina.

## Fluxo e limites

Adicionar alimento → Reconhecer por foto → câmera/galeria → revisão → quantidade em gramas → confirmar refeição. Gramas é a unidade atualmente suportada pelo registro existente; não convertemos ml arbitrariamente em g.

O modelo recebe apenas a imagem normalizada e devolve nomes, alternativas e ambiguidade. O schema rejeita campos extras, incluindo IDs, nutrientes e quantidades. O backend busca exclusivamente alimentos ativos da TACO. Normalização de nomes é compartilhada com a busca existente. Aliases locais resolvem aipim/macaxeira para mandioca; não geram IDs. Correspondência não exata ou ambígua exige escolha explícita. Todos os valores vêm de `nutrientsForFood`; a escala por quantidade usa a mesma função compartilhada do backend. Ausências permanecem null e traços seguem os valores da base.

O endpoint `/api/meals` mantém o contrato de um alimento e também aceita `items: [{foodId, grams}]` (1–20). O lote é validado e inserido numa transação; falha em qualquer alimento reverte todos. Data, refeição, horário e resumo usam a implementação anterior. O callback existente atualiza Diário/Evolução.

Uploads JPEG/PNG/WebP até 5 MiB; máximo de 25 milhões de pixels; rejeita animação/SVG e arquivos inválidos. Sharp decodifica e regrava em JPEG removendo EXIF/localização antes da transmissão à IA. Fotos não são persistidas nem registradas em logs. O navegador mantém só uma URL temporária e a libera ao sair. A foto selecionada é enviada ao backend após escolha; nada é registrado no diário sem confirmação.

Autenticação de sessão e acesso ao paciente antecedem o parser binário; administrador não pode analisar. Limite de 5 análises/minuto por usuário. Serviço local exige bearer token, comparação em tempo constante, loopback e uma requisição simultânea. Limites de inferência/backend/browser: 90/95/100 segundos. Computador desligado/túnel interrompido gera indisponibilidade e oferece busca manual. Nginx precisa permitir mais de 95 segundos para essa rota.

## Instalar no Windows (ação do usuário)

Abra PowerShell na pasta do projeto:

```powershell
cd 'C:\Users\Detona\Documents\Nutri+'
npm ci
powershell -ExecutionPolicy Bypass -File services/food-vision/install.ps1
```

O instalador oficial do Ollama pode abrir sua própria janela. Se o download do modelo falhar, abra Ollama e execute `ollama pull qwen3-vl:4b-instruct` em um novo terminal. Não é necessário instalar CUDA Toolkit manualmente quando o runtime e driver são compatíveis.

Configure o processo Ollama com `OLLAMA_HOST=127.0.0.1:11434`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`. Feche o aplicativo Ollama da bandeja antes de iniciar manualmente, para não disputar a porta:

```powershell
$env:OLLAMA_HOST='127.0.0.1:11434'
$env:OLLAMA_NUM_PARALLEL='1'
$env:OLLAMA_MAX_LOADED_MODELS='1'
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" serve
```

Em outro PowerShell, dentro do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File services/food-vision/start.ps1
```

Os terminais precisam continuar abertos nesta primeira versão. Suspender/desligar o PC suspende o reconhecimento. Não há tarefa agendada/autostart configurada silenciosamente.

## Conexão privada ao Lightsail

Tailscale está presente no Windows, mas o servidor não está associado à rede. Para não exigir login de um novo dispositivo, a implementação usa o SSH existente `nutriplus-prod` como túnel privado criptografado reverso. Tanto Ollama quanto o gateway ficam em 127.0.0.1. O socket remoto também deve ficar em 127.0.0.1; não habilite GatewayPorts yes.

Transfira o token sem exibi-lo:

```powershell
ssh nutriplus-prod 'mkdir -p /home/ubuntu/.config/nutriplus; chmod 700 /home/ubuntu/.config/nutriplus'
scp .codex-local/vision-token nutriplus-prod:/home/ubuntu/.config/nutriplus/vision-token
ssh nutriplus-prod 'chmod 600 /home/ubuntu/.config/nutriplus/vision-token'
powershell -ExecutionPolicy Bypass -File services/food-vision/tunnel.ps1
```

No `.env.local` do servidor, acrescente somente a referência (nenhum segredo em Git):

```text
NUTRI_VISION_TOKEN_FILE=/home/ubuntu/.config/nutriplus/vision-token
```

Instale dependências/publicação pelo procedimento normal, valide Nginx e reinicie backend com a configuração. A configuração versionada inclui timeout só em `/api/foods/recognize`. Não altere variáveis Resend, banco ou AWS Secrets Manager. Para rotação, substitua o arquivo nos dois hosts e reinicie o gateway.

Confirme com `ss -ltn` no servidor que 11435 está em 127.0.0.1; se estiver em 0.0.0.0 ou [::], interrompa o túnel e corrija GatewayPorts antes de usar. Não abrir 11434/11435 em firewall público. Se preferir Tailscale futuramente, primeiro autentique o Lightsail e restrinja acesso na ACL; não expor Ollama diretamente.

## Verificação real

1. Com gateway aberto, execute `powershell -ExecutionPolicy Bypass -File services/food-vision/check.ps1`. Deve responder `ready: true` depois do download do modelo. Para testar uma imagem local real, acrescente `-ImagePath 'C:\caminho\prato.jpg'`. O script não imprime o token.
2. Abra Nutri+ → Adicionar alimento → Reconhecer por foto. Use uma foto real, bem iluminada, com arroz, feijão e uma proteína separados. Confirme itens, alternativas e preparos; a IA pode errar.
3. As quantidades devem iniciar vazias e nada deve existir no diário até confirmar. Troque um item, remova outro e inclua um manualmente.
4. Durante a análise, execute `ollama ps` e `nvidia-smi`. Registre modelo, divisão CPU/GPU, VRAM, duração com modelo frio e quente. Não deduzir GPU apenas pela presença da placa.
5. Confirme a refeição, confira valores com os mesmos alimentos no registro manual e verifique Diário/Evolução sem F5.
6. Feche o túnel e repita análise: indisponibilidade legível e registro manual operacional. Teste foto sem alimento, arquivo corrompido, JPEG acima de 5 MiB e usuário sem sessão.
7. Revise em 360/390/768/1440px: nenhum recorte lateral, botões acessíveis, revisão rolável e quantidades editáveis. Não houve inspeção visual real nesta entrega devido à preferência do usuário por operar o PC.

Se o 4B demorar demais ou causar falta de memória, baixe a variante 2B e altere `NUTRI_VISION_MODEL` no script de inicialização após verificar a licença da tag. Compare pratos iguais; não trocar apenas com base no tamanho. Nunca executar o modelo na instância Lightsail de 2 GB.
