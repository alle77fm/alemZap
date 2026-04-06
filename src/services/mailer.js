import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  }
})

export async function sendWelcomeEmail(email, tempPassword) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Seu acesso ao AlemZap',
    html: `
      <h2>Bem-vindo ao AlemZap!</h2>
      <p>Seu acesso foi criado com sucesso.</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Senha temporária:</strong> ${tempPassword}</p>
      <p>Você será solicitado a criar uma nova senha no primeiro acesso.</p>
      <p><a href="${process.env.DASHBOARD_URL || 'https://painel.italevsistemas.com'}">
        Acessar o painel
      </a></p>
    `
  })
}

export async function sendResetEmail(email, token) {
  const url = `${process.env.DASHBOARD_URL || 'https://painel.italevsistemas.com'}?reset=${token}`
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Recuperação de senha — AlemZap',
    html: `
      <h2>Recuperação de senha</h2>
      <p>Clique no link abaixo para criar uma nova senha:</p>
      <p><a href="${url}">Redefinir minha senha</a></p>
      <p>O link expira em 1 hora.</p>
    `
  })
}
