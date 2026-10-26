import { type FormEvent, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BrandMark } from "../components/Brand";
import { formatMoney, useAppStore } from "../store";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, authReady } = useAppStore();
  const location = useLocation();
  if (!authReady) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Loading</h1>
          <p>Checking your Robomap session…</p>
        </div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

function AppLayout() {
  const { user, logout, resetDemo } = useAppStore();
  const navigate = useNavigate();

  return (
    <div className="app-frame">
      <aside className="side">
        <Link to="/app" className="brand">
          <BrandMark />
          Payments
        </Link>
        <nav className="side-nav">
          <NavLink to="/app" end>
            Home
          </NavLink>
          <NavLink to="/app/send">Send</NavLink>
          <NavLink to="/app/recipients">Recipients</NavLink>
          <NavLink to="/app/activity">Activity</NavLink>
          <NavLink to="/app/add">Add money</NavLink>
          <NavLink to="/app/convert">Convert</NavLink>
        </nav>
        <div className="side-foot">
          <div>{user?.name}</div>
          <div>{user?.email}</div>
          <button
            type="button"
            className="btn btn-ghost side-logout"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            Log out
          </button>
          <button type="button" className="btn btn-ghost side-logout" onClick={resetDemo}>
            Reset demo
          </button>
          <Link to="/" className="btn btn-ghost side-logout">
            Marketing site
          </Link>
        </div>
      </aside>
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}

function Home() {
  const { balances, activity, totalUsd } = useAppStore();
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Home</h1>
          <p>Your multi-currency balances</p>
        </div>
      </div>
      <div className="balance-total">{formatMoney(totalUsd, "USD")}</div>
      <div className="action-row">
        <Link className="btn btn-primary" to="/app/send">
          Send
        </Link>
        <Link className="btn btn-ghost" to="/app/add">
          Add money
        </Link>
        <Link className="btn btn-ghost" to="/app/convert">
          Convert
        </Link>
      </div>
      <div className="balance-grid">
        {balances.map((b) => (
          <div className="balance-tile" key={b.code}>
            <div className="code">{b.code}</div>
            <div className="amt">{formatMoney(b.amount, b.code)}</div>
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="panel-head">
          <h2>Recent activity</h2>
          <Link to="/app/activity">View all</Link>
        </div>
        {activity.length === 0 ? (
          <p className="empty-note">No activity yet. Send or add money to get started.</p>
        ) : (
          <div className="activity-list">
            {activity.slice(0, 5).map((item) => (
              <div className="activity-item" key={item.id}>
                <div>
                  <div className="title">{item.title}</div>
                  <div className="sub">
                    {item.sub} · {item.at}
                  </div>
                </div>
                <div className={`amount ${item.direction === "in" ? "pos" : "neg"}`}>
                  {formatMoney(item.amount, item.currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SendPage() {
  const { recipients, balances, sendMoney } = useAppStore();
  const [recipientId, setRecipientId] = useState(recipients[0]?.id ?? "");
  const [amount, setAmount] = useState(100);
  const [fromCurrency, setFromCurrency] = useState(balances[0]?.code ?? "USD");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const recipient = useMemo(
    () => recipients.find((r) => r.id === recipientId),
    [recipients, recipientId],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = sendMoney({ recipientId, amount, fromCurrency });
    if (!result.ok) {
      setError(result.error || "Could not send");
      setMessage("");
      return;
    }
    setError("");
    setMessage(`Sent ${formatMoney(amount, fromCurrency)} to ${recipient?.name ?? "recipient"}.`);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Send</h1>
          <p>Pay a saved recipient at the mid-market rate.</p>
        </div>
      </div>
      {message ? <div className="success-banner">{message}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="send-layout">
        <form className="panel form-stack" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="recipient">Recipient</label>
            <select
              id="recipient"
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
            >
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.country}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="amount">Amount</label>
            <input
              id="amount"
              type="number"
              min={1}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
            />
          </div>
          <div className="field">
            <label htmlFor="currency">From</label>
            <select
              id="currency"
              value={fromCurrency}
              onChange={(e) => setFromCurrency(e.target.value)}
            >
              {balances.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">
            Send now
          </button>
        </form>
        <div className="panel summary-box">
          <h2>Summary</h2>
          <div className="summary-row">
            <span>Recipient</span>
            <strong>{recipient?.name ?? "—"}</strong>
          </div>
          <div className="summary-row">
            <span>Account</span>
            <strong>{recipient?.accountHint ?? "—"}</strong>
          </div>
          <div className="summary-row">
            <span>You send</span>
            <strong>{formatMoney(amount, fromCurrency)}</strong>
          </div>
        </div>
      </div>
    </>
  );
}

function RecipientsPage() {
  const { recipients, addRecipient } = useAppStore();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [accountHint, setAccountHint] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !country.trim()) return;
    addRecipient({
      name: name.trim(),
      country: country.trim(),
      currency,
      accountHint: accountHint.trim() || "Local account",
    });
    setName("");
    setCountry("");
    setAccountHint("");
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Recipients</h1>
          <p>Save people and businesses you pay often.</p>
        </div>
      </div>
      <div className="send-layout">
        <div className="panel">
          <h2>Saved</h2>
          <div className="recipient-list">
            {recipients.map((r) => (
              <div className="recipient-item" key={r.id}>
                <div>
                  <div className="title">{r.name}</div>
                  <div className="sub">
                    {r.country} · {r.currency} · {r.accountHint}
                  </div>
                </div>
                <span className="badge">{r.lastSent || "New"}</span>
              </div>
            ))}
          </div>
        </div>
        <form className="panel form-stack" onSubmit={onSubmit}>
          <h2>Add recipient</h2>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Country</label>
            <input value={country} onChange={(e) => setCountry(e.target.value)} required />
          </div>
          <div className="field">
            <label>Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option>USD</option>
              <option>EUR</option>
              <option>GBP</option>
              <option>JPY</option>
            </select>
          </div>
          <div className="field">
            <label>Account hint</label>
            <input value={accountHint} onChange={(e) => setAccountHint(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit">
            Save recipient
          </button>
        </form>
      </div>
    </>
  );
}

function ActivityPage() {
  const { activity } = useAppStore();
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Activity</h1>
          <p>Sends, receives, conversions, and top-ups.</p>
        </div>
      </div>
      <div className="panel">
        {activity.length === 0 ? (
          <p className="empty-note">Nothing here yet. Your transfers will show up as you go.</p>
        ) : (
          <div className="activity-list">
            {activity.map((item) => (
              <div className="activity-item" key={item.id}>
                <div>
                  <div className="title">{item.title}</div>
                  <div className="sub">
                    {item.sub} · {item.at}{" "}
                    <span className={`badge ${item.status}`}>{item.status}</span>
                  </div>
                </div>
                <div className={`amount ${item.direction === "in" ? "pos" : "neg"}`}>
                  {formatMoney(item.amount, item.currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function AddMoneyPage() {
  const { addMoney, balances } = useAppStore();
  const [currency, setCurrency] = useState(balances[0]?.code ?? "USD");
  const [amount, setAmount] = useState(250);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = addMoney(currency, amount);
    if (!result.ok) {
      setError(result.error || "Could not add money");
      return;
    }
    setError("");
    setMessage(`Added ${formatMoney(amount, currency)}.`);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Add money</h1>
          <p>Top up a balance from a linked bank or card (demo).</p>
        </div>
      </div>
      {message ? <div className="success-banner">{message}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="panel form-stack" onSubmit={onSubmit} style={{ maxWidth: 420 }}>
        <div className="field">
          <label>Currency</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {balances.map((b) => (
              <option key={b.code}>{b.code}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Amount</label>
          <input
            type="number"
            min={1}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
        </div>
        <button className="btn btn-primary" type="submit">
          Add money
        </button>
      </form>
    </>
  );
}

function ConvertPage() {
  const { balances, convertMoney } = useAppStore();
  const [from, setFrom] = useState(balances[0]?.code ?? "USD");
  const [to, setTo] = useState(balances[1]?.code ?? "EUR");
  const [amount, setAmount] = useState(100);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = convertMoney(from, to, amount);
    if (!result.ok) {
      setError(result.error || "Could not convert");
      return;
    }
    setError("");
    setMessage(`Converted ${formatMoney(amount, from)} toward ${to}.`);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Convert</h1>
          <p>Instant balance conversion at the mid-market rate.</p>
        </div>
      </div>
      {message ? <div className="success-banner">{message}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="panel form-stack" onSubmit={onSubmit} style={{ maxWidth: 420 }}>
        <div className="field">
          <label>From</label>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {balances.map((b) => (
              <option key={b.code}>{b.code}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>To</label>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {balances.map((b) => (
              <option key={b.code}>{b.code}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Amount</label>
          <input
            type="number"
            min={1}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
        </div>
        <button className="btn btn-primary" type="submit">
          Convert now
        </button>
      </form>
    </>
  );
}

export function AppRoutes() {
  return (
    <RequireAuth>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="send" element={<SendPage />} />
          <Route path="recipients" element={<RecipientsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="add" element={<AddMoneyPage />} />
          <Route path="convert" element={<ConvertPage />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
      </Routes>
    </RequireAuth>
  );
}
