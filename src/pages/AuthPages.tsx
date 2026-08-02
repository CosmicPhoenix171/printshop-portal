import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to log in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Customer login">
      <form onSubmit={submit} className="form-stack">
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="button" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <p><Link to="/forgot-password">Forgot password?</Link></p>
      <p>New customer? <Link to="/register">Create an account</Link></p>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(displayName, email, password);
      navigate('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to register.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Create customer account">
      <form onSubmit={submit} className="form-stack">
        <label>Name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} /></label>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></label>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="button" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p>Already registered? <Link to="/login">Log in</Link></p>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await resetPassword(email);
      setMessage('Password reset instructions were sent.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to send reset email.');
    }
  }

  return (
    <AuthCard title="Reset password">
      <form onSubmit={submit} className="form-stack">
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        {message && <div className="alert alert-success">{message}</div>}
        {error && <div className="alert alert-error">{error}</div>}
        <button className="button">Send reset email</button>
      </form>
      <p><Link to="/login">Back to login</Link></p>
    </AuthCard>
  );
}

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark">3D</div>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}
