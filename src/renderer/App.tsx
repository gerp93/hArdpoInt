import { ThemeProvider } from './context/ThemeContext';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';

export default function App() {
  return (
    <ThemeProvider>
      <Layout>
        <Dashboard />
      </Layout>
    </ThemeProvider>
  );
}
