import { Route, Routes } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import AppShell from './components/layout/AppShell';
import { GemDataProvider } from './contexts/GemDataContext';
import HomePage from './pages/HomePage';
import ResultsPage from './pages/ResultsPage';
import theme from './theme';

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GemDataProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/results" element={<ResultsPage />} />
          </Routes>
        </AppShell>
      </GemDataProvider>
    </ThemeProvider>
  );
}
