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

[REGRAS DE CONDUÇÃO]
1. ZERO COMPLACÊNCIA: O mundo não puxa o saco do jogador. NPCs têm interesses próprios, egoísmo, medo e desconfiança de forasteiros.
2. DADOS E CONSEQUÊNCIAS: Role testes de D&D 5E internamente nos bastidores para desafios, furtividade, combate e resistências. Narre a consequência direta com peso físico.
3. FLUXO INICIAL (CRIAÇÃO DO PERSONAGEM ISEKAI):
   - Se for o primeiro turno (o despertar), faça uma introdução sombria e imersiva sobre o peso de ${loreMundo.nome}. Em seguida, exija do jogador apenas 3 escolhas:
     1) Raça
     2) Classe (D&D 5E)
     3) A Anomalia (Um único item de sua escolha do outro mundo que veio com ele).
   - Quando o jogador fornecer essas 3 respostas, VOCÊ (o Mestre) deve:
     * Gerar e listar a ficha completa inicial: Atributos clássicos de D&D 5E (FOR, DES, CON, INT, SAB, CAR), Pontos de Vida (HP), Classe de Armadura (CA) e Condição inicial.
     * Atribuir o equipamento básico de sobrevivência rústico condizente com o cenário.
     * Incorporar a Anomalia escolhida pelo jogador com regras bem definidas (ex: se for uma arma ou objeto moderno, munição/usos estritamente limitados e o impacto do som/tecnologia no mundo).
     * Imediatamente após a ficha, narrar o primeiro suspiro dele no mundo em um dos locais de fronteira.
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
