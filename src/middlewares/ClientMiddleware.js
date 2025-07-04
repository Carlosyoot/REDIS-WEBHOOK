import { encrypt, generateSecretWithSalt } from '../security/Encoder.js';
import pool from '../Client/OracleCliente.js';
import { getCache, setCache, invalidateCache } from "../utils/DynamicCache.js";
import { removeClientFromSecretCache, addClientToSecretCache } from '../utils/SecretsCache.js';
import logger from '../../Logger/Logger.js';



export async function AddClientMiddleware(req,res,next){

    const requiredFields = ['cnpj', 'nome'];
    const missing = requiredFields.filter(field => !req.body[field]);

    if (missing.length > 0) {
        return res.status(400).json({ error: `Campos obrigatórios ausentes: ${missing.join(', ')}` });
    }

    const cnpj = req.body.cnpj.trim();
    const nome = req.body.nome.trim();

    const secret = generateSecretWithSalt();
    const secret_enc = encrypt(secret);

    try{
        const conn = await pool.getConnection();

        const result = await conn.execute(
        `SELECT 1 FROM CLIENTES_API WHERE CNPJ = :cnpj`, [cnpj]);

        if (result.rows.length > 0) {
            await conn.close();
            return res.status(409).json({ error: 'Cliente já existente' });
        }

        await conn.execute(
            `INSERT INTO CLIENTES_API (CNPJ, NOME, SECRET_ENC)
            VALUES (:cnpj, :nome, :secret_enc)`,
            { cnpj, nome, secret_enc },
            { autoCommit: true }
        );

        addClientToSecretCache(secret_enc, nome);
        invalidateCache('CLIENTES:ALL'); 
        invalidateCache(`CLIENTES:${cnpj}`); 

        await conn.close();
            
        return res.status(201).json({ success: true, token: secret });

    } catch (err) {
        logger.error("[CODE] Erro interno ao registrar cliente: ", err);
        return res.status(500).json({ error: 'Erro interno ao registrar cliente' });
    }
}

export async function GetAllClientsMiddleware(req, res) {
    const cacheKey = 'CLIENTES:ALL';
    const cached = getCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    try {
        const conn = await pool.getConnection();

        const result = await conn.execute(
            `SELECT CNPJ, NOME FROM CLIENTES_API ORDER BY NOME`
        );

        await conn.close();

        const formatted = result.rows.map(([cnpj, nome]) => ({ cnpj, nome }));
        setCache(cacheKey, formatted);

        return res.status(200).json(formatted);
    } catch (err) {
        logger.error("[CODE] Erro ao obter clientes: ", err);
        return res.status(500).json({ error: 'Erro ao obter clientes' });
    }
}

export async function GetClientByCNPJMiddleware(req, res) {
    const { cnpj } = req.params;
        if (!cnpj) return res.status(400).json({ error: 'CNPJ não informado' });

    const cacheKey = `CLIENTES:${cnpj}`;
    const cached = getCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    try {
        const conn = await pool.getConnection();

        const result = await conn.execute(
            `SELECT CNPJ, NOME FROM CLIENTES_API WHERE CNPJ = :cnpj`, [cnpj]);

        await conn.close();

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cliente não encontrado' });
        }

        const [CNPJ, NOME] = result.rows[0];
        const response = { cnpj: CNPJ, nome: NOME };
        setCache(cacheKey, response);

        return res.status(200).json(response);
    } catch (err) {
        console.error(err);
        logger.error("[CODE] Erro ao buscar cliente: ", err)
        return res.status(500).json({ error: 'Erro ao buscar cliente' });
    }
}

export async function DeleteClientMiddleware(req, res) {
    const { cnpj } = req.params;

    if (!cnpj) {
        return res.status(400).json({ error: 'CNPJ não informado' });
    }

    try {
        const conn = await pool.getConnection();

        const resultGet = await conn.execute(
            `SELECT SECRET_ENC FROM CLIENTES_API WHERE CNPJ = :cnpj`, [cnpj]
        );

        if (resultGet.rows.length === 0) {
            await conn.close();
            return res.status(404).json({ error: 'Cliente não encontrado para exclusão' });
        }

        const [secret_enc] = resultGet.rows[0];

        const result = await conn.execute(
            `DELETE FROM CLIENTES_API WHERE CNPJ = :cnpj`, [cnpj], { autoCommit: true });

        invalidateCache('CLIENTES:ALL'); 
        invalidateCache(`CLIENTES:${cnpj}`); 
        removeClientFromSecretCache(secret_enc); 

        await conn.close();

        return res.status(200).json({ success: true, cnpj });
    } catch (err) {
        console.error(err);
        logger.error("[CODE] Erro ao excluir cliente: ", err)
        return res.status(500).json({ error: 'Erro ao excluir cliente' });
    }
}

    