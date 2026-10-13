export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido.' });
    }

    const { historicoChat, userId, npcsConhecidos, statusJogador, inventario } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY; 
    const MODELOS = ["gemini-3.8-flash", "gemini-2.5-flash"];

    // 1. BUSCA O MUNDO DINÂMICO DIRETO DO SEU FIREBASE (REST API)
    let loreMundo = {
        nome: "Aethelgard",
        tom: "Dark Fantasy D&D 5E brutal.",
        geopolitica: "Protetorado de Valenor, Principados Livres de Oakhaven, Ermo Cinzento.",
        locais: "Ouro-Velho, Pântano das Sete Léguas, Gelo-Morto."
    };

    try {
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/tavern-rpg-567f2/databases/(default)/documents/mundo/aethelgard`;
        const firestoreRes = await fetch(firestoreUrl);
        if (firestoreRes.ok) {
            const data = await firestoreRes.json();
            loreMundo = {
                nome: data.fields?.nome?.stringValue || loreMundo.nome,
                tom: data.fields?.tom?.stringValue || loreMundo.tom,
                geopolitica: data.fields?.geopolitica_macro?.stringValue || loreMundo.geopolitica,
                locais: data.fields?.locais_micro?.stringValue || loreMundo.locais
            };
        }
    } catch (e) {
        console.warn("[Firebase] Usando lore local de contingência:", e.message);
    }

    // Formata o contexto dos NPCs conhecidos para a IA
    const contextoNPCs = (npcsConhecidos && npcsConhecidos.length > 0)
        ? JSON.stringify(npcsConhecidos, null, 2)
        : "Nenhum NPC registrado ainda nesta campanha.";

    // 2. DIRETRIZES DO MESTRE, CADÊNCIA, DADOS E SISTEMA VIVO
    const SYSTEM_INSTRUCTION = `
Você é o Mestre implacável, neutro e narrativo de uma campanha de Dark Fantasy baseada estritamente em D&D 5E.
O mundo é hostil, realista, com escassez de recursos e indiferente ao jogador.

[IDENTIFICADOR DO JOGADOR ATUAL]
UID do Jogador agindo agora: "${userId || "jogador_local"}"

[LEIS DO MUNDO CARREGADAS DO FIREBASE]
- Mundo: ${loreMundo.nome}
- Tom: ${loreMundo.tom}
- Geopolítica (Macro): 
${loreMundo.geopolitica}
- Locais e Frentes de Conflito (Micro): 
${loreMundo.locais}

[NPCS REGISTRADOS E SUAS MEMÓRIAS]
${contextoNPCs}

[FICHA E INVENTÁRIO ATUAL DO JOGADOR]
Status: ${statusJogador ? JSON.stringify(statusJogador) : "Ainda não criado"}
Inventário: ${inventario && inventario.length > 0 ? JSON.stringify(inventario) : "Vazio / Não definido"}

[REGRAS FUNDAMENTAIS DE CONDUÇÃO]
1. CADÊNCIA DE TURNO ÚNICO (UMA AÇÃO POR VEZ):
   - Resolva apenas a ação imediata. Nunca avance dias ou acontecimentos por conta própria. Se o jogador tentar fazer várias coisas, pare no primeiro obstáculo.

2. SISTEMA DE DADOS MODERADO:
   - Role dados quando houver risco real, oposição ou consequência de falha.
   - Mostre o cálculo no topo da mensagem:
     🎲 Teste de [Nome]: d20 [resultado] + [mod] = [total] vs DC [dificuldade] -> [Sucesso/Falha].

3. DESCANSO REALISTA (GRITTY REALISM):
   - Curto: 8h (apenas gasta Dados de Vida). Longo: 7 dias em segurança e abrigo seco. Dormir na lama causa frio/exaustão.

4. RODAPÉ OBRIGATÓRIO DE STATUS (HUD):
   - No final de CADA narração, inclua:
     [HP: X/Y | CA: Z | Condição: ... | Recursos: ...]

5. FLUXO INICIAL (CRIAÇÃO DO PERSONAGEM ISEKAI):
   - Se for o primeiro turno, receba as 4 definições (Nome, Raça, Classe, Anomalia).
   - Além da narração e da ficha descrita, você DEVE anexar OBRIGATORIAMENTE no final da mensagem o bloco exato:
===ESTADO_INICIAL===
{
  "status_jogador": {
    "nome": "Nome",
    "raca": "Raça",
    "classe": "Classe",
    "nivel": 1,
    "hp_atual": 10,
    "hp_max": 10,
    "ca": 14,
    "condicoes": ["Desorientado"],
    "atributos": { "FOR": 10, "DES": 16, "CON": 14, "INT": 12, "SAB": 10, "CAR": 14 }
  },
  "inventario": [
    { "id": "anomalia", "nome": "Nome do Item Anômalo", "tipo": "anomalia", "qtd": 1, "municao": 100, "detalhes": "Efeito especial" },
    { "id": "adaga", "nome": "Adaga", "tipo": "arma", "qtd": 1, "detalhes": "1d4 perfurante" },
    { "id": "racao", "nome": "Rações de viagem", "tipo": "consumivel", "qtd": 3, "detalhes": "3 dias de comida seca" }
  ]
}
===FIM_ESTADO_INICIAL===

6. SISTEMA DINÂMICO DE NPCS (MEMÓRIA VIVA E AFINIDADE):
   - NPCs têm vida própria, medos, ambições e rancores. Ninguém confia de graça.
   - A relação é medida de -100 (ódio mortal/vingança) a +100 (lealdade jurada). 0 é indiferente/desconfiado.
   - Se um NPC estiver em cena, reaja estritamente à relação que ele tem com o jogador "${userId}".
   - Se um NPC NOVO aparecer ou um NPC existente INTERAGIR, sofrer ameaça, receber ajuda ou mudar de status, você DEVE anexar OBRIGATORIAMENTE no final da mensagem (após o HUD) o bloco estruturado no formato exato:
===ATUALIZACAO_NPC===
{
  "id": "identificador_unico_minusculo",
  "nome": "Nome do NPC",
  "idade": 35,
  "aparencia": "Descrição visual concisa",
  "personalidade": "Traços marcantes de conduta",
  "local_atual": "Onde ele está agora",
  "status_vida": "O que estava fazendo antes ou o que planeja fazer a seguir",
  "relacoes_jogadores": {
    "${userId || "jogador_local"}": {
      "pontos": 0,
      "como_enxerga": "Descrição curta de como vê este jogador especificamente",
      "ultimo_fato": "Resumo em 1 linha do que aconteceu entre eles neste turno"
    }
  }
}
===FIM_NPC===

7. SISTEMA DE GASTO E DANO (ATUALIZAÇÃO DE ESTADO):
   - Se o jogador TOMAR DANO, SE CURAR, GASTAR MUNIÇÃO/RECURSO ou GANHAR UM ITEM NOVO durante a narrativa, adicione no fim da mensagem:
===ATUALIZACAO_ESTADO===
{
  "dano_sofrido": 0,
  "cura_recebida": 0,
  "novas_condicoes": [],
  "remover_condicoes": [],
  "itens_gastos": [{ "id": "anomalia", "qtd_municao_gasta": 1 }, { "id": "racao", "qtd_gasta": 1 }],
  "itens_ganhos": [{ "id": "chave_ferro", "nome": "Chave Enferrujada", "tipo": "item", "qtd": 1, "detalhes": "Achada no lodo" }]
}
===FIM_ATUALIZACAO_ESTADO===
`;

    const payload = {
        system_instruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }]
        },
        contents: historicoChat
    };

    let sucesso = false;
    let textoIA = "";
    let erroFinal = "";
    let modeloVencedor = "";

    for (let i = 0; i < MODELOS.length; i++) {
        const modeloAtual = MODELOS[i];
        const URL = `https://generativelanguage.googleapis.com/v1beta/models/${modeloAtual}:generateContent?key=${API_KEY}`;

        try {
            const response = await fetch(URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const textoBruto = await response.text();

            if (!response.ok) {
                erroFinal = `Erro ${response.status} no ${modeloAtual}`;
                console.warn(`[Fallback] ${erroFinal}`);
                continue; 
            }

            const data = JSON.parse(textoBruto);
            textoIA = data.candidates[0].content.parts[0].text;
            sucesso = true;
            modeloVencedor = modeloAtual.replace('gemini-', ''); 
            break;

        } catch (error) {
            erroFinal = `Erro no fetch: ${error.message}`;
        }
    }

    if (sucesso) {
        let npcExtraido = null;
        let estadoInicial = null;
        let estadoAtualizado = null;
        let textoLimpo = textoIA;

        // 1. Extrai NPC
        const regexNPC = /===ATUALIZACAO_NPC===([\s\S]*?)===FIM_NPC===/;
        const matchNPC = textoLimpo.match(regexNPC);
        if (matchNPC) {
            try { 
                npcExtraido = JSON.parse(matchNPC[1].trim()); 
            } catch (e) {
                console.warn("Falha ao parsear NPC:", e.message);
            }
            textoLimpo = textoLimpo.replace(regexNPC, '').trim();
        }

        // 2. Extrai Estado Inicial (Criação de Ficha)
        const regexEstadoIni = /===ESTADO_INICIAL===([\s\S]*?)===FIM_ESTADO_INICIAL===/;
        const matchEstadoIni = textoLimpo.match(regexEstadoIni);
        if (matchEstadoIni) {
            try { 
                estadoInicial = JSON.parse(matchEstadoIni[1].trim()); 
            } catch (e) {
                console.warn("Falha ao parsear Estado Inicial:", e.message);
            }
            textoLimpo = textoLimpo.replace(regexEstadoIni, '').trim();
        }

        // 3. Extrai Atualização de Estado (Dano, Gasto de Itens, Loot)
        const regexAtualizacao = /===ATUALIZACAO_ESTADO===([\s\S]*?)===FIM_ATUALIZACAO_ESTADO===/;
        const matchAtualizacao = textoLimpo.match(regexAtualizacao);
        if (matchAtualizacao) {
            try { 
                estadoAtualizado = JSON.parse(matchAtualizacao[1].trim()); 
            } catch (e) {
                console.warn("Falha ao parsear Atualização de Estado:", e.message);
            }
            textoLimpo = textoLimpo.replace(regexAtualizacao, '').trim();
        }

        return res.status(200).json({ 
            texto: textoLimpo, 
            modelo: modeloVencedor,
            npcAtualizado: npcExtraido,
            estadoInicial: estadoInicial,
            estadoAtualizado: estadoAtualizado
        });
    } else {
        return res.status(500).json({ error: `O Mestre caiu. Último aviso: ${erroFinal}` });
    }
}
