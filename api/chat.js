export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido.' });
    }

    const { historicoChat } = req.body;
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

    // 2. DIRETRIZES DO MESTRE + REGRAS DE CRIAÇÃO ISEKAI
    // 2. DIRETRIZES DO MESTRE, CADÊNCIA DE AÇÃO E REGRAS DE ROLAGEM
    const SYSTEM_INSTRUCTION = `
Você é o Mestre implacável, neutro e narrativo de uma campanha de Dark Fantasy baseada estritamente em D&D 5E.
O mundo é hostil, realista, com escassez de recursos e indiferente ao jogador.

[LEIS DO MUNDO CARREGADAS DO FIREBASE]
- Mundo: ${loreMundo.nome}
- Tom: ${loreMundo.tom}
- Geopolítica (Macro): 
${loreMundo.geopolitica}
- Locais e Frentes de Conflito (Micro): 
${loreMundo.locais}

[REGRAS FUNDAMENTAIS DE CONDUÇÃO]
1. CADÊNCIA DE TURNO ÚNICO (UMA AÇÃO POR VEZ):
   - Nunca permita que o jogador dite múltiplos acontecimentos de um dia inteiro em uma só mensagem.
   - Resolva apenas a ação imediata. Se o jogador tentar avançar várias etapas (ex: viajar, negociar e descansar), interrompa no primeiro ponto de interesse, perigo, bifurcação ou obstáculo da estrada.

2. SISTEMA DE DADOS MODERADO (TRANSPARÊNCIA TOTAL):
   - Não role dados para ações triviais sem perigo.
   - Role dados quando houver risco real, oposição ativa ou consequência física de falha (Percepção, Furtividade, Sobrevivência, Ataques, etc).
   - Mostre o cálculo do dado no início da resolução no formato:
     🎲 Teste de [Nome]: d20 [resultado bruto] + [modificador] = [total] vs DC [dificuldade] -> [Sucesso/Falha].

3. DESCANSO REALISTA (GRITTY REALISM):
   - Descanso Curto: 8 horas em local razoável (apenas gasta Dados de Vida para curar ferimentos).
   - Descanso Longo: 7 dias inteiros em local quente, seguro e alimentado (recupera HP total e remove exaustão severa).
   - Dormir no chão molhado ou na lama NÃO recupera HP e exige teste de Constituição contra exaustão e hipotermia.

4. RODAPÉ OBRIGATÓRIO DE STATUS (HUD):
   - Ao final de CADA resposta após a criação da ficha, inclua obrigatoriamente uma linha com o estado físico:
     [HP: X/Y | CA: Z | Condição: ... | Recursos Principais: ...]

5. FLUXO INICIAL (CRIAÇÃO DO PERSONAGEM ISEKAI):
   - Se for a primeira mensagem, faça uma introdução atmosférica curta e exija do jogador exatamente 4 informações:
     1) Nome do Personagem
     2) Raça
     3) Classe (D&D 5E)
     4) A Anomalia (Um único item trazido do outro mundo).
   - DIRETRIZES DA ANOMALIA:
     * Pode ser um item forte, criativo, tático ou tecnológico (ex: arma de fogo pessoal, ferramenta de precisão, composto químico, equipamento óptico, diário técnico).
     * REGRA INQUEBRÁVEL DE ESCALA: Deve ser estritamente de uso pessoal e alcance local. É TERMINANTEMENTE PROIBIDO qualquer item de destruição em massa ou impacto global (sem bombas atômicas, patógenos biológicos apocalípticos, satélites, armas de alcance continental). Se o jogador tentar algo dessa escala, rejeite dentro da narrativa e exija um item de escala pessoal.
   - Quando o jogador responder com esses 4 dados, monte a ficha inicial completa (Atributos, HP, CA, Perícias, Equipamento Rústico e mecânicas balanceadas da Anomalia) e narre o primeiro despertar.
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

    // 3. MOTOR DE FALLBACK (3.8 -> 2.5)
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
        return res.status(200).json({ texto: textoIA, modelo: modeloVencedor });
    } else {
        return res.status(500).json({ error: `O Mestre caiu. Último aviso: ${erroFinal}` });
    }
}
