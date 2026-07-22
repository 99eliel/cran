SISTEMA CRAN — VERSÃO 2.0.0
Projeto Firebase: cran2026

PRINCIPAIS MÓDULOS
- Login e perfis de acesso.
- Pacientes e fila de espera paginada.
- Encaminhamento para profissionais.
- Pacientes em atendimento.
- Agenda diária, semanal e mensal.
- Relatórios com filtros, CSV e impressão/PDF.
- Profissionais e usuários.
- Arquivo morto, importação histórica, cadastro manual e restauração.
- Migração controlada das filas de espera.
- PWA instalável com atualização automática.

NOVIDADES DA VERSÃO 2.0.0
- Condições escritas junto ao nome foram separadas em campos próprios.
- Urgência, Prioritário e Eletivo são classificações.
- Pós-operatório, AVC e Respiratório são tipos da Fisioterapia.
- Domiciliar é modalidade.
- A fila ganhou filtro e etiquetas por condição.
- É possível editar nome, telefones, especialidade, tipo, classificação, modalidade, data e observações diretamente na fila.
- Cancelar e fechar o formulário de encaminhamento foram corrigidos.
- Datas ausentes ficam no final da fila.
- A migração pode atualizar condições sem reabrir pacientes já encaminhados por uma versão anterior.

MIGRAÇÃO DAS FILAS
Use somente o arquivo privado:
fila-espera-cran-2026-condicoes-organizadas.json

O JSON contém 798 pacientes consolidados e 897 entradas aguardando.
Não coloque o JSON no GitHub, no Firebase Hosting ou dentro da pasta pública.

TESTAR NO VS CODE
1. Extraia todos os arquivos na mesma pasta.
2. Abra a pasta inteira no VS Code.
3. Abra index.html com Live Server.
4. Use localhost no navegador.
5. Pressione Ctrl + Shift + R após substituir uma versão.
6. Se necessário: F12 > Application > Storage > Clear site data.

PUBLICAR NO FIREBASE HOSTING
1. firebase login
2. firebase use cran2026
3. firebase deploy --only hosting

Para publicar também as regras:
firebase deploy

Não é necessário publicar índices compostos para esta versão.
