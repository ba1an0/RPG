function limparJson(texto) {
    if (!texto) return "";
    return texto
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido.' });
    }

    const { 
        historicoChat, 
        userId, 
        npcsConhecidos, 
        statusJogador, 
        inventario, 
        estadoMundo 
    } = req.body;

    const API_KEY = process.env.GEMINI_API_KEY; 
    const MODELOS = ["gemini-3.8-flash", "gemini-2.5-flash"];

    // 1. BUSCA O MUNDO MACRO DIRETO DO FIREBASE (REST API)
    let loreMundo = {
        nome: "Aethelgard",
        tom: "Dark Fantasy D&D 5E brutal.",
        geopolitica: "Protetorado de Valenor, Principados Livres de Oakhaven, Ermo Cinzento.",
        locais: "Ouro-Velho, Pântano das Sete Léguas, Gelo-Morto."
    };

    try {
        const firestoreUrl = `[https://firestore.googleapis.com/v1/projects/tavern-rpg-567f2/databases/(default)/documents/mundo/aethelgard](https://firestore.googleapis.com/v1/projects/tavern-rpg-567f2/databases/(default)/documents/mundo/aethelgard)`;
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

    // 2. JANELA DESLIZANTE DO HISTÓRICO (Evita estouro de tokens em campanhas longas)
    let historicoRecente = Array.isArray(historicoChat) ? [...historicoChat] : [];
    const LIMITE_MENSAGENS = 16;
    if (historicoRecente.length > LIMITE_MENSAGENS) {
        historicoRecente = historicoRecente.slice(-LIMITE_MENSAGENS);
    }
    // A API do Gemini exige que a primeira mensagem do array contents seja sempre 'user'
    while (historicoRecente.length > 0 && historicoRecente[0].role !== 'user') {
        historicoRecente.shift();
    }

    const contextoNPCs = (npcsConhecidos && npcsConhecidos.length > 0)
        ? JSON.stringify(npcsConhecidos, null, 2)
        : "Nenhum NPC registrado ainda nesta campanha.";

    const contextoMundoCampanha = estadoMundo
        ? JSON.stringify(estadoMundo, null, 2)
        : "Início da jornada.";

    // 3. DIRETRIZES DO MESTRE E MOTOR DE PERSISTÊNCIA
    const SYSTEM_INSTRUCTION = `
Você é o Mestre implacável, neutro e narrativo de uma campanha de Dark Fantasy baseada estritamente em D&D 5E.
O mundo é hostil, realista, com escassez de recursos e indiferente ao jogador.

[IDENTIFICADOR DO JOGADOR ATUAL]
UID do Jogador agindo agora: "${userId || "jogador_local"}"

[LEIS MACRO DO MUNDO (FIREBASE)]
- Mundo: ${loreMundo.nome}
- Tom: ${loreMundo.tom}
- Geopolítica (Macro): 
${loreMundo.geopolitica}
- Locais e Frentes de Conflito (Micro): 
${loreMundo.locais}

[ESTADO ATUAL DO MUNDO NESTA CAMPANHA]
${contextoMundoCampanha}

[FICHA, VÍNCULOS E INVENTÁRIO ATUAL DO JOGADOR]
Status e Crônica: ${statusJogador ? JSON.stringify(statusJogador, null, 2) : "Ainda não criado"}
Inventário: ${inventario && inventario.length > 0 ? JSON.stringify(inventario, null, 2) : "Vazio / Não definido"}

[NPCS CONHECIDOS E SUAS MEMÓRIAS CUMULATIVAS]
${contextoNPCs}

[REGRAS FUNDAMENTAIS DE CONDUÇÃO]
1. CADÊNCIA DE TURNO ÚNICO (UMA AÇÃO POR VEZ):
   - Resolva apenas a ação imediata declarada pelo jogador.
   - Nunca permita que o jogador narre um dia inteiro ou múltiplas etapas de uma vez. Interrompa sempre no primeiro obstáculo, encontro, perigo ou decisão tática.

2. SISTEMA DE DADOS MODERADO E TRANSPARENTE:
   - Não role dados para ações triviais sem risco.
   - Role dados sempre que houver risco real, oposição ativa ou consequência de falha.
   - Mostre o cálculo no topo da resposta:
     🎲 Teste de [Perícia/Ataque]: d20 ([valor]) + [mod] = [total] vs DC/CA [dificuldade] -> [Sucesso/Falha].

3. DESCANSO REALISTA (GRITTY REALISM):
   - Descanso Curto: 8h (apenas gasta Dados de Vida).
   - Descanso Longo: 7 dias inteiros em local seguro, seco e aquecido. Dormir no relento ou na lama não recupera HP e exige teste de Constituição contra frio/exaustão.

4. RODAPÉ OBRIGATÓRIO DE STATUS (HUD):
   - Ao final do texto narrativo (antes dos blocos de sistema), inclua sempre:
     [HP: X/Y | CA: Z | Local: ... | Condições: ... | Recursos: ...]

5. FLUXO INICIAL (CRIAÇÃO DO PERSONAGEM ISEKAI):
   - Na primeira mensagem da campanha, dê as boas-vindas sombrias e exija as 4 definições:
     1) Nome do Personagem
     2) Raça
     3) Classe (D&D 5E)
     4) A Anomalia (Um único item pessoal, tático ou tecnológico trazido do outro mundo. PROIBIDO itens de destruição em massa ou impacto global).
   - Quando o jogador fornecer esses 4 dados, apresente a ficha no texto, narre o despertar e anexe OBRIGATORIAMENTE no final da resposta (sem blocos markdown) o bloco:
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
    "condicoes": ["Desorientado", "Molhado"],
    "marcos_e_vinculos": ["Forasteiro recém-desperto em Aethelgard"],
    "atributos": { "FOR": 10, "DES": 16, "CON": 14, "INT": 12, "SAB": 10, "CAR": 14 }
  },
  "inventario": [
    { "id": "anomalia", "nome": "Nome da Anomalia", "tipo": "anomalia", "qtd": 1, "municao": 100, "detalhes": "Dano e regras especiais" },
    { "id": "arma_inicial", "nome": "Espada Curta", "tipo": "arma", "qtd": 1, "detalhes": "1d6 perfurante" },
    { "id": "racao", "nome": "Rações de Viagem", "tipo": "consumivel", "qtd": 3, "detalhes": "Comida seca" },
    { "id": "moedas_cobre", "nome": "Peças de Cobre (CP)", "tipo": "moeda", "qtd": 15, "detalhes": "Moeda local" }
  ],
  "estado_mundo": {
    "local_atual": "Nome do local inicial",
    "tempo_clima": "Dia 1 - Chuva fria e neblina",
    "fatos_mundo": []
  }
}
===FIM_ESTADO_INICIAL===

6. SISTEMA DINÂMICO DE NPCS (MEMÓRIA CUMULATIVA):
   - NPCs têm interesses próprios, preconceitos e memória permanente. A relação vai de -100 (ódio mortal) a +100 (lealdade).
   - Sempre que um NPC novo surgir ou um NPC existente interagir de forma relevante com o jogador, anexe no final da resposta (um bloco para cada NPC envolvido na cena):
===ATUALIZACAO_NPC===
{
  "id": "id_unico_minusculo_sem_espacos",
  "nome": "Nome do NPC",
  "idade": 35,
  "aparencia": "Descrição visual curta",
  "personalidade": "Traços de comportamento",
  "local_atual": "Onde ele está agora",
  "status_vida": "Vivo / Ferido / Morto / O que planeja fazer",
  "relacoes_jogadores": {
    "${userId || "jogador_local"}": {
      "pontos": 0,
      "como_enxerga": "Como este NPC enxerga o jogador atualmente",
      "nova_memoria": "Fato marcante que aconteceu neste turno entre eles"
    }
  }
}
===FIM_NPC===

7. SISTEMA DE EVOLUÇÃO, VÍNCULOS, MUNDO E INVENTÁRIO:
   - Sempre que o jogador sofrer dano, curar, mudar de local, ganhar/perder condições físicas, ganhar/gastar itens ou conquistar um MARCO PERMANENTE (ex: casar com alguém, fazer um juramento, ganhar uma cicatriz permanente, ganhar um título, ser caçado por uma facção ou alterar algo no mundo), anexe no final da resposta:
===ATUALIZACAO_ESTADO===
{
  "dano_sofrido": 0,
  "cura_recebida": 0,
  "nova_ca": null,
  "novo_nivel": null,
  "novo_hp_max": null,
  "novo_local": null,
  "novo_tempo_clima": null,
  "novas_condicoes": [],
  "remover_condicoes": [],
  "novos_marcos_personagem": [],
  "remover_marcos_personagem": [],
  "novos_fatos_mundo": [],
  "itens_gastos": [],
  "itens_ganhos": []
}
===FIM_ATUALIZACAO_ESTADO===
   - Formato de "itens_gastos": [{ "id": "id_do_item", "qtd_gasta": 1, "qtd_municao_gasta": 0 }]
   - Formato de "itens_ganhos": [{ "id": "id_do_item", "nome": "Nome", "tipo": "item", "qtd": 1, "detalhes": "Descrição" }]
   - REGRA CRÍTICA DE FORMATAÇÃO: NUNCA use crases de markdown (\`\`\`json) dentro das tags ===...===. Escreva apenas o JSON puro entre as tags.
`;

    const payload = {
        system_instruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }]
        },
        contents: historicoRecente
    };

    let sucesso = false;
    let textoIA = "";
    let erroFinal = "";
    let modeloVencedor = "";

    for (let i = 0; i < MODELOS.length; i++) {
        const modeloAtual = MODELOS[i];
        const URL = `[https://generativelanguage.googleapis.com/v1beta/models/$](https://generativelanguage.googleapis.com/v1beta/models/$){modeloAtual}:generateContent?key=${API_KEY}`;

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
        let npcsExtraidos = [];
        let estadoInicial = null;
        let estadoAtualizado = null;
        let textoLimpo = textoIA;

        // 1. Extrai TODOS os blocos de NPC da resposta (suporta múltiplos NPCs na cena)
        const regexNPCGlobal = /===ATUALIZACAO_NPC===([\s\S]*?)===FIM_NPC===/g;
        const matchesNPC = [...textoLimpo.matchAll(regexNPCGlobal)];
        for (const match of matchesNPC) {
            try {
                const parsed = JSON.parse(limparJson(match[1]));
                if (Array.isArray(parsed)) {
                    npcsExtraidos.push(...parsed);
                } else if (parsed && parsed.id) {
                    npcsExtraidos.push(parsed);
                }
            } catch (e) {
                console.warn("Falha ao parsear bloco de NPC:", e.message);
            }
        }
        textoLimpo = textoLimpo.replace(regexNPCGlobal, '').trim();

        // 2. Extrai Estado Inicial (Criação de Ficha)
        const regexEstadoIni = /===ESTADO_INICIAL===([\s\S]*?)===FIM_ESTADO_INICIAL===/;
        const matchEstadoIni = textoLimpo.match(regexEstadoIni);
        if (matchEstadoIni) {
            try { 
                estadoInicial = JSON.parse(limparJson(matchEstadoIni[1])); 
            } catch (e) {
                console.warn("Falha ao parsear Estado Inicial:", e.message);
            }
            textoLimpo = textoLimpo.replace(regexEstadoIni, '').trim();
        }

        // 3. Extrai Atualização de Estado (Dano, Vínculos, Mundo, Inventário)
        const regexAtualizacao = /===ATUALIZACAO_ESTADO===([\s\S]*?)===FIM_ATUALIZACAO_ESTADO===/;
        const matchAtualizacao = textoLimpo.match(regexAtualizacao);
        if (matchAtualizacao) {
            try { 
                estadoAtualizado = JSON.parse(limparJson(matchAtualizacao[1])); 
            } catch (e) {
                console.warn("Falha ao parsear Atualização de Estado:", e.message);
            }
            textoLimpo = textoLimpo.replace(regexAtualizacao, '').trim();
        }

        return res.status(200).json({ 
            texto: textoLimpo, 
            modelo: modeloVencedor,
            npcsAtualizados: npcsExtraidos,
            estadoInicial: estadoInicial,
            estadoAtualizado: estadoAtualizado
        });
    } else {
        return res.status(500).json({ error: `O Mestre caiu. Último aviso: ${erroFinal}` });
    }
}
