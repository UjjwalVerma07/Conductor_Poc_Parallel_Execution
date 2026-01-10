import React, { useMemo, useState } from 'react';
// App: wraps the designer with a light/dark theme and persists preference.
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import WorkflowDesigner from './components/WorkflowDesigner';

function App() {
  const [mode, setMode] = useState<'light' | 'dark'>(() => (localStorage.getItem('themeMode') as 'light' | 'dark') || 'light');

  const theme = useMemo(() => createTheme({
    palette: {
      mode,
      primary: { main: '#1976d2' },
      secondary: { main: '#dc004e' },
    },
  }), [mode]);

  const toggleTheme = () => {
    const next = mode === 'light' ? 'dark' : 'light';
    setMode(next);
    localStorage.setItem('themeMode', next);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <WorkflowDesigner themeMode={mode} onToggleTheme={toggleTheme} />
    </ThemeProvider>
  );
}

export default App;

