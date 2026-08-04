// tests/login2toques.test.tsx
// ---------------------------------------------------------------
// POR QUE ESTE TESTE EXISTE
// O login em 2 toques foi decisão consciente do Renan depois de "muita
// recusa" no campo (LIÇÃO #2): operário com pouca familiaridade digital
// NÃO digita e-mail comprido no celular. Isso não é detalhe de UI — é
// requisito de adoção do app.
//
// Este teste é o contrato dessa decisão. Ele é escrito de propósito SEM
// citar nome, e-mail ou o config.ts: assim ele continua valendo depois do
// patch B (lista vinda do banco) e é justamente ele que prova que o
// patch B não regrediu a UX. Se ele quebrar, alguém devolveu o teclado
// para o operário.
// ---------------------------------------------------------------
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));

vi.mock('../services/supabaseClient', () => ({
  supabase: {
    auth: { signInWithPassword: signIn },
    // o patch B faz a tela buscar a lista no banco; antes dele este
    // trecho é simplesmente ignorado
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({
          data: [
            { slug: 'equipeteste', rotulo: 'Equipe Teste', emoji: '🚨', grupo: 'campo' },
            { slug: 'gestorteste', rotulo: 'Gestor Teste', emoji: '📊', grupo: 'gestao' },
          ],
          error: null,
        }),
      }),
    }),
  },
  configOk: true,
}));

import LoginScreen from '../components/LoginScreen';

describe('LoginScreen — o login em 2 toques (LIÇÃO #2)', () => {
  it('abre pedindo para TOCAR NO NOME, não para digitar e-mail', async () => {
    render(<LoginScreen />);

    expect(await screen.findByText(/toque no seu nome/i)).toBeInTheDocument();
    // o campo de digitar e-mail NÃO pode ser o caminho principal
    expect(screen.queryByPlaceholderText(/seu e-mail de acesso/i)).not.toBeInTheDocument();
  });

  it('🔴 TOQUE 1: escolher o nome leva direto à senha, SEM digitar e-mail', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await screen.findByText(/toque no seu nome/i);
    const nomes = screen.getAllByRole('button');
    expect(nomes.length).toBeGreaterThan(1);   // a lista existe

    await user.click(nomes[0]);                // TOQUE 1

    // TOQUE 2 é só a senha
    expect(await screen.findByPlaceholderText(/digite a senha/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/seu e-mail de acesso/i)).not.toBeInTheDocument();
    // e dá para voltar se tocou no nome errado
    expect(screen.getByRole('button', { name: /trocar/i })).toBeInTheDocument();
  });

  it('"trocar" volta para a lista de nomes (tocou no colega por engano)', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await screen.findByText(/toque no seu nome/i);
    await user.click(screen.getAllByRole('button')[0]);
    await screen.findByPlaceholderText(/digite a senha/i);

    await user.click(screen.getByRole('button', { name: /trocar/i }));

    expect(await screen.findByText(/toque no seu nome/i)).toBeInTheDocument();
  });

  it('🔴 LIÇÃO #2: espaço do teclado do celular é aparado antes de autenticar', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({ error: null });
    render(<LoginScreen />);

    await screen.findByText(/toque no seu nome/i);
    await user.click(screen.getAllByRole('button')[0]);

    const senha = await screen.findByPlaceholderText(/digite a senha/i);
    await user.type(senha, '  senha123  ');    // teclado móvel adora sobrar espaço
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith({
      // o e-mail é derivado da escolha, nunca digitado; sempre minúsculo
      email: expect.stringMatching(/^[a-z0-9._-]+@fpv\.app$/),
      password: 'senha123',                    // sem os espaços
    });
  });

  it('senha errada mostra recado em português, com a dica do olhinho', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<LoginScreen />);

    await screen.findByText(/toque no seu nome/i);
    await user.click(screen.getAllByRole('button')[0]);
    await user.type(await screen.findByPlaceholderText(/digite a senha/i), 'errada');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    // nada de "Invalid login credentials" na cara do eletricista
    expect(await screen.findByText(/senha incorreta/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid login credentials/i)).not.toBeInTheDocument();
  });

  it('a senha começa escondida e o 👁 revela (conferir o que digitou)', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await screen.findByText(/toque no seu nome/i);
    await user.click(screen.getAllByRole('button')[0]);

    const senha = await screen.findByPlaceholderText(/digite a senha/i);
    expect(senha).toHaveAttribute('type', 'password');

    await user.click(screen.getByTitle(/ver a senha/i));
    expect(senha).toHaveAttribute('type', 'text');
  });
});
