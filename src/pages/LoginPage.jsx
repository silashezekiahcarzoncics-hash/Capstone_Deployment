import { useState } from 'react';
import saipherLogo from '../assets/saiphercg.jpg';
import '../styles/login.css';

const LOGIN_EMAIL = 'saiphercg@gmail.com';
const LOGIN_PASSWORD = 'saiphercg123';

export default function LoginPage({ onAuthenticated }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');

    function handleSubmit(event) {
        event.preventDefault();
        if (email.trim().toLowerCase() !== LOGIN_EMAIL || password !== LOGIN_PASSWORD) {
            setError('The email or password is incorrect. Please try again.');
            return;
        }
        setError('');
        onAuthenticated();
    }

    return (
        <main className="login-page">
            <section className="login-card" aria-labelledby="login-title">
                <div className="login-brand">
                    <div className="login-logo-frame">
                        <img src={saipherLogo} alt="Saipher CG logo" />
                    </div>
                    <span className="login-brand-name">SAIPHER CG <b>DSS</b></span>
                </div>

                <div className="login-heading">
                    <span className="login-eyebrow">DASHBOARD ACCESS</span>
                    <h1 id="login-title">Saipher CG Login</h1>
                    <p>Review sales, forecasts, and recommended actions.</p>
                </div>

                <form className="login-form" onSubmit={handleSubmit}>
                    <label>
                        <span>Email</span>
                        <input
                            type="email"
                            name="email"
                            value={email}
                            onChange={event => { setEmail(event.target.value); setError(''); }}
                            autoComplete="username"
                            placeholder="Enter your email"
                            required
                            autoFocus
                        />
                    </label>
                    <label className="login-password-label">
                        <span>Password</span>
                        <div className="login-password-field">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                name="password"
                                value={password}
                                onChange={event => { setPassword(event.target.value); setError(''); }}
                                autoComplete="current-password"
                                placeholder="Enter your password"
                                required
                            />
                            <button
                                type="button"
                                className="login-password-toggle"
                                onClick={() => setShowPassword(current => !current)}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                aria-pressed={showPassword}
                            >
                                {showPassword ? 'Hide' : 'Show'}
                            </button>
                        </div>
                    </label>
                    {error && <p className="login-error" role="alert">{error}</p>}
                    <button type="submit" className="login-submit">Log in</button>
                </form>
                <p className="login-footer">Geographic Market Decision Support System</p>
            </section>
        </main>
    );
}
