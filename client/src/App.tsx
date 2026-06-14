import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import { connect } from './socket/client';
import { connectionEstablished } from './store/connection.slice';
import { attachSocketListeners } from './middleware/socket.middleware';
import { Home } from './pages/Home';
import { Table } from './pages/Table';
import { theme } from './styles/theme';
import { GlobalStyle } from './styles/GlobalStyle';

export function App() {
  const dispatch = useDispatch();
  useEffect(() => {
    const socket = connect();
    attachSocketListeners(socket, dispatch);
    socket.on('connect', () => dispatch(connectionEstablished(socket.id ?? '')));
  }, [dispatch]);

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:code" element={<Table />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
