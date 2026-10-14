// Extrai apenas o objeto/array JSON válido, mesmo se houver texto ou markdown ao redor
function extrairJsonSeguro(texto) {
    if (!texto) return null;
    let limpo = texto
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

    const inicioObj = limpo.indexOf('{');
    const fimObj = limpo.lastIndexOf('}');

    if (inicioObj !== -1 && fimObj !== -1 && fimObj > inicioObj) {
        limpo = limpo.substring(inicioObj, fimObj + 1);
    }

    return JSON.parse(limpo);
}

// Rola dados reais no servidor para impedir viés estatístico da IA
function rolarDados(lados, quantidade) {
    const resultados = [];
    for (let i = 0; i < quantidade; i++) {
        resultados.push(Math.floor(Math.random() * lados) + 1);
    }
    return resultados;
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
    const MODELOS = ["gemini-3.5-flash", "gemini-2.5-flash"];

    // 1. BUSCA O MUNDO MACRO DIRETO DO FIREBASE (REST API)
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

    // 2. JANELA DESLIZANTE DO HISTÓRICO ENVIADO À IA (Últimas 16 mensagens)
    let historicoRecente = Array.isArray(historicoChat) ? [...historicoChat] : [];
    const LIMITE_MENSAGENS = 16;
    if (historicoRecente.length > LIMITE_MENSAGENS) {
        historicoRecente = historicoRecente.slice(-LIMITE_MENSAGENS);
    }
    while (historicoRecente.length > 0 && historicoRecente[0].role !== 'user') {
        historicoRecente.shift();
    }

    // 3. POOL DE DADOS REAIS SORTEADOS NO SERVIDOR PARA ESTE TURNO
    const filaDados = {
        d20: rolarDados(20, 4),
        d12: rolarDados(12, 2),
        d10: rolarDados(10, 2),
        d8: rolarDados(8, 3),
        d6: rolarDados(6, 4),
        d4: rolarDados(4, 3)
    };

    // 4. SEPARAÇÃO INTELIGENTE DE NPCS (Locais/Citados vs Distantes para não inflar tokens)
    const uid = userId || "jogador_local";
    const localAtual = (estadoMundo?.local_atual || "").toLowerCase();
    const ultimaMsgUsuario = (historicoRecente[historicoRecente.length - 1]?.parts?.[0]?.text || "").toLowerCase();

    let contextoNPCs = "Nenhum NPC registrado ainda nesta campanha.";
    if (Array.isArray(npcsConhecidos) && npcsConhecidos.length > 0) {
        const npcsLocais = [];
        const npcsDistantes = [];

        npcsConhecidos.forEach(npc => {
            const localNpc = (npc.local_atual || "").toLowerCase();
            const nomeNpc = (npc.nome || "").toLowerCase();
            const partesNome = nomeNpc.split(/[\s,_-]+/).filter(p => p.length > 2);
            
            // Só considera mesmo local se o texto do local bater de verdade
            const mesmoLocal = localAtual && localNpc && (localAtual.includes(localNpc) || localNpc.includes(localAtual));
            const foiCitado = partesNome.some(parte => ultimaMsgUsuario.includes(parte));

            // TRAVA RÍGIDA: Nunca coloca NPC distante como presente só porque a lista é pequena
            if (mesmoLocal || foiCitado) {
                npcsLocais.push(npc);
            } else {
                const rel = npc.relacoes_jogadores?.[uid] || { pontos: 0, como_enxerga: "Indiferente" };
                npcsDistantes.push(`- ${npc.nome} (id: ${npc.id}) | Local Fixo: ${npc.local_atual} | Status: ${npc.status_vida} | Afinidade: ${rel.pontos}`);
            }
        });

        contextoNPCs = `[NPCS PRESENTES NESTE LOCAL EXATO (PODEM INTERAGIR)]:\n${npcsLocais.length > 0 ? JSON.stringify(npcsLocais, null, 2) : "Nenhum NPC conhecido está aqui. Todos os guardas ou habitantes deste local são NOVOS e desconhecidos."}\n\n[NPCS DISTANTES EM OUTRAS REGIÕES (PROIBIDO SURGIREM OU INTERAGIREM AQUI)]:\n${npcsDistantes.length > 0 ? npcsDistantes.join('\n') : "Nenhum."}`;
    }

    // 5. TRAVA DE EMERGÊNCIA PARA 0 DE HP (INCONSCIENTE / AGONIZANDO)
    const alertaZeroHP = (statusJogador && Number(statusJogador.hp_atual) <= 0)
        ? `\n⚠️ [ALERTA CRÍTICO DE SISTEMA: JOGADOR COM 0 DE HP!] ⚠️\nO jogador está CAÍDO, INCONSCIENTE ou AGONIZANDO (0 HP). Você é PROIBIDO de permitir que ele realize ações físicas normais (correr, atacar, falar normalmente). Exija imediatamente um Teste Contra a Morte (Death Save de D&D 5E: d20 puro, >=10 sucesso, <10 falha) usando o primeiro d20 da fila do servidor, ou narre as consequências brutais de sua queda (ser roubado, capturado ou morto).\n`
        : "";

    const contextoMundoCampanha = estadoMundo
        ? JSON.stringify(estadoMundo, null, 2)
        : "Início da jornada.";

    // 6. DIRETRIZES DO MESTRE E MOTOR DE PERSISTÊNCIA
    const SYSTEM_INSTRUCTION = `
Você é o Mestre implacável, neutro e narrativo de uma campanha de Dark Fantasy baseada estritamente em D&D 5E.
O mundo é hostil, realista, com escassez de recursos e indiferente ao jogador.
${alertaZeroHP}
[IDENTIFICADOR DO JOGADOR ATUAL]
UID do Jogador agindo agora: "${uid}"

[FILA DE DADOS REAIS SORTEADOS PELO SERVIDOR NESTE TURNO]
- d20 disponíveis (use nesta ordem): [${filaDados.d20.join(', ')}]
- d12: [${filaDados.d12.join(', ')}] | d10: [${filaDados.d10.join(', ')}] | d8: [${filaDados.d8.join(', ')}] | d6: [${filaDados.d6.join(', ')}] | d4: [${filaDados.d4.join(', ')}]
REGRA DE OURO DOS DADOS: Você é PROIBIDO de inventar valores de dados. Se a ação exigir rolagem de d20 ou dano, utilize OBRIGATORIAMENTE o primeiro número disponível da respectiva fila acima!

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

[MEMÓRIA DE NPCS]
${contextoNPCs}

[REGRAS FUNDAMENTAIS DE CONDUÇÃO]
0. CONSISTÊNCIA GEOGRÁFICA E ANTI-GASLIGHTING (LEI ABSOLUTA):
   - É TERMINANTEMENTE PROIBIDO teletransportar NPCs de outras regiões ou justificar erros alegando que o jogador "se perdeu e andou em círculos" sem que tenha havido falha explícita em teste de Sobrevivência.
   - NPCs de regiões distantes NÃO existem na cena atual. Se o jogador encontrar guardas, salteadores ou monstros em um local novo, gere SEMPRE uma entidade nova com nome e ID inéditos.
   - Se o jogador apontar um erro de continuidade ou localização em tom de correção (ex: [OFF]), reconheça o erro imediatamente, desfaça a contradição e siga a coerência do mapa sem inventar desculpas narrativas.

1. CADÊNCIA DE TURNO ÚNICO E ANTI-GODMODING:
   - Resolva apenas UMA ação imediata por vez. Se o jogador tentar narrar várias etapas ou viajar dias em uma frase, interrompa no primeiro obstáculo ou encontro.
   - INTENÇÃO VS RESULTADO: Tudo o que o jogador escreve é APENAS a tentativa/intenção dele, nunca um fato consumado. Se ele escrever "eu mato o guarda e acho 50 moedas", ignore o resultado imposto por ele, exija o teste usando a fila de dados do servidor e julgue com rigor. O jogador NUNCA pode inventar itens no chão ou controlar reações de NPCs.

2. SISTEMA DE DADOS MODERADO, VANTAGEM E TÁTICA REALISTA:
   - REGRA DE ATACANTE OCULTO (VANTAGEM): Se o jogador atacar estando escondido, camuflado ou de emboscada sem ser visto, role SEMPRE com VANTAGEM (pegue os dois primeiros d20 da fila do servidor e use OBRIGATORIAMENTE o maior). Adicione o dano de Ataque Furtivo do Ladino.
   - TIRO MIRADO / EMBOSCADA A QUEIMA-ROUPA: Se o jogador estiver em silêncio, mirando com calma em um alvo estático e desprevenido, aplique bônus circunstancial (+2 a +5 no teste) ou considere a CA do alvo desprovida de bônus de esquiva.
   - NARRATIVA COERENTE DE CA: Se o teste de ataque falhar contra a CA de um inimigo de armadura, NUNCA narre que o atirador errou o alvo no ar a curta distância. Narre que o projétil atingiu a placa de ferro, o elmo de aço ou o escudo e ricocheteou em faíscas sem perfurar a proteção vital.
   - Mostre o cálculo no topo da resposta:
     🎲 Teste de Ataque (com Vantagem): d20 ([dado1], [dado2] -> usa [maior]) + [mod] = [total] vs CA [defesa] -> [Sucesso/Falha].

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
   - Quando o jogador fornecer esses 4 dados, apresente a ficha no texto, narre o despertar e anexe OBRIGATORIAMENTE no final da resposta o bloco:
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
  "status_vida": "Estado físico atual, o que está fazendo, segredos descobertos ou observações livres sobre ele",
  "relacoes_jogadores": {
    "${uid}": {
      "pontos": 0,
      "como_enxerga": "Como este NPC enxerga o jogador atualmente",
      "nova_memoria": "Fato marcante que aconteceu neste turno entre eles"
    }
  }
}
===FIM_NPC===

7. SISTEMA DE AUDITORIA DE RECURSOS, ESCASSEZ E INVENTÁRIO (NADA É INFINITO):
   - PROIBIÇÃO ABSOLUTA DE ITENS INFINITOS: Inspecione obrigatoriamente a lista [INVENTÁRIO ATUAL] antes de narrar qualquer ação.
   - GATILHOS MECÂNICOS OBRIGATÓRIOS (DEVE DESCONTAR NO JSON):
     * Comeu algo ou descansou? DEVE reduzir a quantidade de ração em 1 ("qtd_gasta": 1). Se qtd for 0, o jogador sofre FOME e EXAUSTÃO.
     * Acendeu fogo ou iluminou? DEVE reduzir tochas em 1 ("qtd_gasta": 1).
     * Disparou arma? DEVE reduzir munição ("qtd_municao_gasta": 1).
     * Recarregou a arma? É TERMINANTEMENTE PROIBIDO colocar a contagem apenas no texto de "observacao". Você DEVE preencher obrigatoriamente o campo "nova_municao" com o número exato de balas no tambor (ex: "nova_municao": 6).
   - Se o jogador tentar usar um item que está com quantidade 0 na mochila, a ação FALHA na narrativa por falta de suprimentos.
   - Sempre que houver mudanças físicas, de mundo ou de inventário, anexe no final da resposta:
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
  "remover_fatos_mundo": [],
  "itens_gastos": [],
  "itens_ganhos": [],
  "itens_observacao": []
}
===FIM_ATUALIZACAO_ESTADO===
   - Formato de "itens_gastos": [{ "id": "id_do_item", "qtd_gasta": 1, "qtd_municao_gasta": 0, "nova_municao": null, "nova_qtd": null }]
   - Formato de "itens_ganhos": [{ "id": "id_do_item", "nome": "Nome", "tipo": "item", "qtd": 1, "detalhes": "Descrição" }]
   - Formato de "itens_observacao": [{ "id": "id_do_item", "observacao": "Nota livre sobre esconderijo ou estado do item", "nova_municao": null }]
   - REGRA CRÍTICA: NUNCA use crases (\`\`\`json) dentro das tags ===...===. Feche sempre todas as tags corretamente.
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
        let npcsExtraidos = [];
        let estadoInicial = null;
        let estadoAtualizado = null;
        let textoLimpo = textoIA;

        // 1. Extrator Tolerante para NPCs (suporta múltiplos blocos e fechamento omitido)
        const regexNPCGlobal = /===ATUALIZACAO_NPC===([\s\S]*?)(?:===FIM_NPC===|(?====[A-Z_]+===)|$)/g;
        const matchesNPC = [...textoLimpo.matchAll(regexNPCGlobal)];
        for (const match of matchesNPC) {
            try {
                const parsed = extrairJsonSeguro(match[1]);
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

        // 2. Extrator Tolerante para Estado Inicial
        const regexEstadoIni = /===ESTADO_INICIAL===([\s\S]*?)(?:===FIM_ESTADO_INICIAL===|===FIM_ESTADO===|(?====[A-Z_]+===)|$)/;
        const matchEstadoIni = textoLimpo.match(regexEstadoIni);
        if (matchEstadoIni) {
            try { 
                estadoInicial = extrairJsonSeguro(matchEstadoIni[1]); 
            } catch (e) {
                console.warn("Falha ao parsear Estado Inicial:", e.message);
            }
            textoLimpo = textoLimpo.replace(regexEstadoIni, '').trim();
        }

        // 3. Extrator Tolerante para Atualização de Estado
        const regexAtualizacao = /===ATUALIZACAO_ESTADO===([\s\S]*?)(?:===FIM_ATUALIZACAO_ESTADO===|===FIM_ATUALIZACAO===|(?====[A-Z_]+===)|$)/;
        const matchAtualizacao = textoLimpo.match(regexAtualizacao);
        if (matchAtualizacao) {
            try { 
                estadoAtualizado = extrairJsonSeguro(matchAtualizacao[1]); 
            } catch (e) {
                console.warn("Falha ao parsear Atualização de Estado:", e.message);
            }
            textoLimpo = textoLimpo.replace(regexAtualizacao, '').trim();
        }

        // Limpa qualquer tag residual órfã que possa ter sobrado
        textoLimpo = textoLimpo.replace(/===[A-Z_]+===/g, '').trim();

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
