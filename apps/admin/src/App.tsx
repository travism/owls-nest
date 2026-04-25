import { Routes, Route, Link } from 'react-router-dom';

function Dashboard() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Owl's Nest Admin</h1>
      <p>Shell placeholder. Auth + dashboard land in M2.</p>
      <nav style={{ marginTop: '1rem' }}>
        <Link to="/login">Login</Link>
      </nav>
    </main>
  );
}

function Login() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Login</h1>
      <p>Login form lands in M2.</p>
      <Link to="/">Back to dashboard</Link>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/login" element={<Login />} />
    </Routes>
  );
}
