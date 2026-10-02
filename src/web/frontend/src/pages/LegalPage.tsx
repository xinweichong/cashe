import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { NavBar } from '@/components/ui/nav-bar';
import { Button } from '@/components/ui/button';

// Public pages: rendered outside the auth gate so the login screen and
// Google's OAuth consent screen can link to them.

const EFFECTIVE_DATE = '2 October 2026';
const CONTACT_EMAIL = 'CONTACT_EMAIL_TODO';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-lg font-bold tracking-[-0.01em] text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function LegalPage({ title, other, children }: { title: string; other: { label: string; to: string }; children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Opened directly (no in-app history): back goes to the app root.
  const goBack = () => (location.key === 'default' ? navigate('/') : navigate(-1));
  return (
    <div className="min-h-dvh bg-background">
      <NavBar title={title} back={{ label: 'Back', onClick: goBack }} />
      <article className="mx-auto max-w-2xl space-y-6 px-4 pb-12 pt-4 text-sm leading-relaxed text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        <p className="text-muted">Effective {EFFECTIVE_DATE}</p>
        {children}
        <Section title="Contact">
          <p>Questions or requests: <a className="text-teal underline-offset-4 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        </Section>
        <Button variant="link" size="sm" className="h-auto min-h-11 p-0" asChild>
          <Link to={other.to}>{other.label}</Link>
        </Button>
      </article>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" other={{ label: 'Terms of service', to: '/terms' }}>
      <p>
        cashe is a personal expense tracker run privately for a small group of invited users.
        It is not a commercial service. This policy explains what it collects, why, and who else sees it.
      </p>

      <Section title="What cashe collects">
        <ul>
          <li><strong>Account details:</strong> your username, a hashed password, and the devices signed in to your account (browser user agent and last-used time).</li>
          <li><strong>Gmail:</strong> if you connect Gmail, cashe reads messages only from the bank and payment senders it is configured for (such as DBS PayLah! and UOB alerts). It extracts the amount, currency, merchant and time, and keeps the original message content so a transaction can be re-checked. It does not read other mail and does not send, delete or relabel anything.</li>
          <li><strong>Apple Wallet:</strong> if you set up the iOS Shortcut, cashe receives the merchant, amount, card label and time of each Wallet payment you send it.</li>
          <li><strong>Telegram:</strong> if you link Telegram, cashe stores your chat ID and the messages you send the bot to add or edit transactions.</li>
          <li><strong>What you enter:</strong> transactions, categories, budgets, goals, trips, subscriptions and settings.</li>
        </ul>
      </Section>

      <Section title="How it is used">
        <p>
          Your data is used only to show you your own spending: recording transactions, categorising them,
          spotting recurring charges, and sending you the summaries and notifications you set up.
          cashe has no advertising, does not sell or rent data, and does not use it to build profiles for anyone else.
        </p>
      </Section>

      <Section title="Google user data">
        <p>
          cashe's use and transfer of information received from Google APIs adheres to the{' '}
          <a className="text-teal underline-offset-4 hover:underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
          including the Limited Use requirements. Gmail data is used only to provide the transaction-capture
          feature you turned on. It is not transferred to others except as described under "Services cashe relies on",
          is not used for advertising, and is not read by people unless you ask for help with a specific message,
          it is needed for security, or the law requires it. It is never used to train AI models.
        </p>
      </Section>

      <Section title="Services cashe relies on">
        <ul>
          <li><strong>Oracle Cloud</strong> hosts the server and its databases.</li>
          <li><strong>Cloudflare</strong> carries traffic to the site over HTTPS, and stores encrypted backups.</li>
          <li><strong>Telegram</strong> delivers bot messages if you link it.</li>
          <li><strong>Google Gemini</strong>, when the optional AI features are switched on, receives the text of Telegram messages you send in plain language and summaries of your spending to write insights. It is never sent Gmail content.</li>
          <li>An <strong>exchange-rate service</strong> is asked for currency rates; it receives no personal data.</li>
        </ul>
      </Section>

      <Section title="Storage, security and retention">
        <p>
          Each user's data lives in a separate database. Passwords are hashed, the site is served only over HTTPS,
          and off-site backups are encrypted before they leave the server. Data is kept until you delete it or ask
          for your account to be removed. Deleted data disappears from encrypted backups as they age out, within about a year.
        </p>
      </Section>

      <Section title="Your choices">
        <ul>
          <li>Edit or delete any transaction in the app.</li>
          <li>Disconnect Gmail or Telegram in Settings at any time. You can also revoke cashe's Gmail access from your Google Account's security settings.</li>
          <li>Ask for a copy of your data, or for your account and all its data to be deleted.</li>
        </ul>
      </Section>

      <Section title="Changes">
        <p>If this policy changes, the effective date above changes with it. Significant changes will be announced in the app or on Telegram.</p>
      </Section>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of service" other={{ label: 'Privacy policy', to: '/privacy' }}>
      <p>
        These terms cover your use of cashe, a personal expense tracker run privately for invited users.
        By signing in you agree to them.
      </p>

      <Section title="Accounts">
        <p>
          Accounts are by invitation only. Keep your password private; you are responsible for activity on your account.
          Accounts may be suspended or removed if they are misused or put the service at risk.
        </p>
      </Section>

      <Section title="What cashe is, and is not">
        <p>
          cashe helps you record and understand your own spending. It is not a bank, does not move money,
          and does not give financial, tax or legal advice. Transactions captured from email, Apple Wallet or
          Telegram, and exchange-rate conversions, can be late, missing or wrong. Check anything important
          against your bank's own records.
        </p>
      </Section>

      <Section title="Your data">
        <p>
          Your data stays yours. You let cashe process it only to run the features you use, as described in the{' '}
          <Link className="text-teal underline-offset-4 hover:underline" to="/privacy">privacy policy</Link>.
        </p>
      </Section>

      <Section title="Acceptable use">
        <ul>
          <li>Don't try to reach other users' data or the server beyond your own account.</li>
          <li>Don't connect accounts that aren't yours.</li>
          <li>Don't overload or disrupt the service.</li>
        </ul>
      </Section>

      <Section title="Availability">
        <p>
          cashe is provided as is, without warranties of any kind. It may be changed, paused or shut down.
          Where possible you will be told in advance so you can ask for a copy of your data.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          To the extent the law allows, the operator of cashe is not liable for losses arising from using it,
          including decisions made on information it shows.
        </p>
      </Section>

      <Section title="Changes and governing law">
        <p>
          These terms may be updated; the effective date above shows the latest version, and continuing to use
          cashe means you accept it. These terms are governed by the laws of Singapore.
        </p>
      </Section>
    </LegalPage>
  );
}
