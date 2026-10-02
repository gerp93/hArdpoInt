import { ThemeProvider } from './context/ThemeContext';
import { AssistantDock } from './components/AssistantDock';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';

export default function App() {
  return (
    <ThemeProvider>
      <Layout>
        <Dashboard />
      </Layout>
      <AssistantDock />
    </ThemeProvider>
  );
}
