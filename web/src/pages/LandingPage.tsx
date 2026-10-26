import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BrandMark } from "../components/Brand";

const RATES = [
  { pair: "USD → EUR", value: "0.923" },
  { pair: "USD → GBP", value: "0.787" },
  { pair: "USD → JPY", value: "149.2" },
  { pair: "EUR → GBP", value: "0.853" },
];

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [send, setSend] = useState(1000);
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("EUR");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const rate = from === "USD" && to === "EUR" ? 0.923 : from === to ? 1 : 0.85;
  const fee = Math.max(from === "USD" || from === "EUR" || from === "GBP" ? 0.8 : 1.2, send * 0.0045);
  const receive = Math.max(0, (send - fee) * rate);

  return (
    <div className="app-shell">
      <nav className={`site-nav${scrolled ? " scrolled" : ""}`}>
        <div className="inner">
          <Link to="/" className="brand">
            <BrandMark />
            Robomap
          </Link>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#rates">Rates</a>
            <a href="#account">Account</a>
          </div>
          <div className="nav-actions">
            <Link to="/login" className="btn btn-ghost">
              Log in
            </Link>
            <Link to="/login" className="btn btn-primary">
              Open account
            </Link>
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-media" aria-hidden="true" />
        <div className="hero-content">
          <div className="hero-copy">
            <p className="hero-brand">
              Payments<span>.</span>
            </p>
            <h1 className="hero-title">Money that moves like a local.</h1>
            <p className="hero-support">
              Send abroad at the real mid-market rate. Hold 40+ currencies in one borderless account.
            </p>
            <div className="hero-ctas">
              <Link to="/login" className="btn btn-mint">
                Get started
              </Link>
              <a href="#how" className="btn btn-soft">
                See how it works
              </a>
            </div>
          </div>
          <div className="hero-panel">
            <div className="calc">
              <div className="calc-row">
                <label>You send</label>
                <div className="calc-field">
                  <input
                    type="number"
                    min={1}
                    value={send}
                    onChange={(e) => setSend(Number(e.target.value) || 0)}
                  />
                  <select value={from} onChange={(e) => setFrom(e.target.value)}>
                    <option>USD</option>
                    <option>EUR</option>
                    <option>GBP</option>
                  </select>
                </div>
              </div>
              <button
                type="button"
                className="swap-btn"
                aria-label="Swap currencies"
                onClick={() => {
                  setFrom(to);
                  setTo(from);
                }}
              >
                ↕
              </button>
              <div className="calc-row">
                <label>They get</label>
                <div className="calc-field">
                  <input readOnly value={receive.toFixed(2)} />
                  <select value={to} onChange={(e) => setTo(e.target.value)}>
                    <option>EUR</option>
                    <option>GBP</option>
                    <option>USD</option>
                    <option>JPY</option>
                  </select>
                </div>
              </div>
              <div className="calc-meta">
                <span>
                  Rate <strong>{rate.toFixed(4)}</strong>
                </span>
                <span>
                  Fee <strong>{fee.toFixed(2)} {from}</strong> · usually by tomorrow
                </span>
              </div>
              <Link to="/login" className="btn btn-primary btn-block">
                Check this transfer
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="rate-strip" id="rates" aria-label="Sample mid-market rates">
        {RATES.map((r) => (
          <span key={r.pair}>
            {r.pair} <em>{r.value}</em>
          </span>
        ))}
      </div>

      <section className="section" id="how">
        <div className="container split">
          <div>
            <div className="section-head">
              <h2>Send money without the bank markup</h2>
              <p>
                Robomap shows the mid-market rate up front, then a small transparent fee — the same
                idea that made Wise famous, mapped onto the industrial and technical services you
                already run on Robomap.
              </p>
            </div>
            <ul className="feature-list">
              <li>
                <strong>Real exchange rate</strong>
                <span>No hidden spread. You always see the fee separately.</span>
              </li>
              <li>
                <strong>Track every hop</strong>
                <span>From funded to delivered, with clear arrival estimates.</span>
              </li>
              <li>
                <strong>Save recipients once</strong>
                <span>Repeat transfers in seconds — rent, payroll, family.</span>
              </li>
            </ul>
          </div>
          <div className="visual-plane" aria-hidden="true">
            <div className="route-line" />
            <span className="pin a" />
            <span className="pin b" />
          </div>
        </div>
      </section>

      <section className="section" id="account">
        <div className="container">
          <div className="section-head">
            <h2>One account. Many currencies.</h2>
            <p>
              Hold balances, convert instantly, and get local details to receive like a resident —
              without opening a bank in every country.
            </p>
          </div>
          <div className="balance-grid">
            {[
              { code: "USD", name: "US Dollar" },
              { code: "EUR", name: "Euro" },
              { code: "GBP", name: "British Pound" },
              { code: "JPY", name: "Japanese Yen" },
            ].map((e) => (
              <div className="balance-tile" key={e.code}>
                <div className="code">{e.code}</div>
                <div className="amt">{e.name}</div>
              </div>
            ))}
          </div>
          <Link to="/login" className="btn btn-primary">
            Open your Robomap account
          </Link>
        </div>
      </section>

      <footer className="footer">
        <div className="container inner">
          <strong>Robomap Payments</strong>
          <span>Demo product · Not a licensed money transmitter</span>
        </div>
      </footer>
    </div>
  );
}
