export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido.' });
    }

    const { historicoChat } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY; 

    // Vamos priorizar o 2.5 primeiro que sabemos que rodou liso pra vc de graça, 
    // e deixamos o 3.8 como segunda opção (ou vice-versa no futuro)
    const MODELOS = ["gemini-2.5-flash", "gemini-3.8-flash"];
    
    const payload = {
        system_instruction: {
            parts: [{ text: "Você é um implacável mestre de RPG de mesa de D&D 5E focado em Dark Fantasy. Seja descritivo, sombrio e direto nas consequências das ações. Role dados nos bastidores se necessário." }]
        },
        contents: historicoChat
    };

    let sucesso = false;
    let textoIA = "";
    let erroFinal = "";
    let modeloVencedor = "";

    for (let i = 0; i < MODELOS.length; i++) {
        const modeloAtual = MODELOS[i];
        
        // Voltando pro v1beta que é onde seus modelos novos moram
        const URL = `https://generativelanguage.googleapis.com/v1beta/models/${modeloAtual}:generateContent?key=${API_KEY}`;

        try {
            const response = await fetch(URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const textoBruto = await response.text();

            if (!response.ok) {
                // A CORREÇÃO DE OURO: Agora, se der QUALQUER erro (402, 404, 503), ele anota e PULA pro próximo!
                erroFinal = `Erro ${response.status} no ${modeloAtual}`;
                console.warn(erroFinal); // Fica salvo no log do Vercel
                continue; 
            }

            const data = JSON.parse(textoBruto);
            textoIA = data.candidates[0].content.parts[0].text;
            sucesso = true;
            modeloVencedor = modeloAtual.replace('gemini-', ''); // Deixa o badge mais limpo
            break; 

        } catch (error) {
            erroFinal = `Erro no fetch: ${error.message}`;
        }
    }

    if (sucesso) {
        return res.status(200).json({ texto: textoIA, modelo: modeloVencedor });
    } else {
        return res.status(500).json({ error: `Todas as opções de Mestre falharam. Último aviso: ${erroFinal}` });
    }
}
