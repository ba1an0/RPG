export default async function handler(req, res) {
    // 1. Só aceita requisições POST do seu próprio site
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido.' });
    }

    // 2. Recebe o histórico do celular do jogador
    const { historicoChat } = req.body;
    
    // 3. Puxa a chave SECRETA que vai ficar escondida no painel do Vercel
    const API_KEY = process.env.GEMINI_API_KEY; 

    // 4. A Ordem de Prioridade: 3.8 absoluto na frente, 2.5 como estepe
    const MODELOS = ["gemini-3.8-flash", "gemini-2.5-flash"];
    
    // 5. As regras do seu RPG (Ficam escondidas no servidor)
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

    // O Motor Inteligente de Fallback rodando na Nuvem
    for (let i = 0; i < MODELOS.length; i++) {
        const modeloAtual = MODELOS[i];
        
        // A rota v1beta é obrigatória para acessar o 3.8 e o 2.5
        const URL = `https://generativelanguage.googleapis.com/v1beta/models/${modeloAtual}:generateContent?key=${API_KEY}`;

        try {
            const response = await fetch(URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const textoBruto = await response.text();

            if (!response.ok) {
                // Se der QUALQUER erro (503 lotado, 402 sem saldo, 429 limite), ele anota e PULA pro próximo!
                erroFinal = `Erro ${response.status} no ${modeloAtual}`;
                console.warn(`[Aviso do Servidor] ${erroFinal}. Tentando o próximo...`); 
                continue; 
            }

            // SUCESSO!
            const data = JSON.parse(textoBruto);
            textoIA = data.candidates[0].content.parts[0].text;
            sucesso = true;
            
            // Limpa o nome para a etiqueta no front-end ficar bonitinha (ex: "3.8-flash")
            modeloVencedor = modeloAtual.replace('gemini-', ''); 
            break; // Achou um que funciona, sai do loop de tentativas!

        } catch (error) {
            erroFinal = `Erro na requisição da nuvem: ${error.message}`;
        }
    }

    // 6. Devolve só o texto e o modelo vencedor pro celular do jogador
    if (sucesso) {
        return res.status(200).json({ texto: textoIA, modelo: modeloVencedor });
    } else {
        return res.status(500).json({ error: `Todas as opções de Mestre falharam. Último aviso: ${erroFinal}` });
    }
}
