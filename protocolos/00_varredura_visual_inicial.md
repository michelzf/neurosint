# Protocolo 00 — Varredura Visual Inicial (OBRIGATÓRIO)

**Quando aplicar:** no início de toda sessão de análise do caso, ANTES de qualquer
análise textual, despacho de agentes ou geração de relatório.

**Por que existe (lição real, anonimizada):** num caso real, produziu-se uma análise
multidisciplinar completa (4 agentes em paralelo, ~600 linhas) **sem ter aberto** uma
imagem comparativa de eletrodos que já estava no repositório — e que continha as medições
objetivas do mau posicionamento. O médico humano confirmou o achado por reconstrução 3D
24 h depois. **A descoberta estava no repositório o tempo todo.** Este protocolo nasceu disso.

## Checklist (executar em ordem)

### Etapa 1 — Listagem
Liste todas as pastas de imagem do repositório do paciente. Exemplos típicos:
```bash
ls -la imagens/ DBS/ DBS/Reconstructions/ DBS/Segmentations/ DBS/Key_Slices/
```

### Etapa 2 — Abrir TODAS as imagens
Priorize por palavras-chave no nome: `comparacao`, `fusion`, `montage`, `composite`,
`key`, `reconstruction`, `segmentation`, `electrode`, `DBS`, `radiografia`.

**Regra:** use o tool `Read` — ele abre PNG/JPEG **visualmente**. **NÃO julgue a
relevância pelo nome do arquivo.** Abra tudo.

### Etapa 3 — Se houver DICOM relevante, rodar ou considerar a fusão
```bash
cd tools/dbs_fusion
./run_pipeline.sh <pasta_RM_pre_op> <pasta_TC_pos_op> <pasta_saida>
```
Se o pipeline já foi rodado em sessões anteriores, verifique o `report.md` na pasta de
saída **antes** de rodar de novo.

### Etapa 4 — MCP `exams` para DICOMs avulsos (opcional)
Para um exame DICOM novo não coberto pelo pipeline:
`view-medical-image`, `read-dicom-metadata`, `read-dicom-series`.

### Etapa 5 — Registrar achados visuais
Crie/atualize um `ACHADOS_VISUAIS_CONSOLIDADOS.md` (ou uma seção no relatório-alvo) com o
que foi descoberto visualmente. **Esta seção é o PILAR do briefing dos agentes, não um apêndice.**

### Etapa 6 — Só então despachar agentes
Nos prompts dos agentes paralelos, inclua um bloco **"ACHADOS VISUAIS JÁ CONSOLIDADOS"**
para que construam sobre esses dados em vez de recomendá-los como "fazer".

## Checklist de validação antes de concluir a sessão

- [ ] Todas as imagens do repositório foram abertas nesta sessão (ou em sessão anterior documentada)?
- [ ] Itens marcados como "pendente" no resumo foram verificados fisicamente no repositório?
- [ ] Os agentes despachados receberam os achados visuais como contexto?
- [ ] Nenhum agente recomendou fazer algo que já existe no repositório?
