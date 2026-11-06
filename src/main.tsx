import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { client } from './game/client';
import './styles.css';

// 调试/自动化测试句柄：便于端到端测试读取内部状态
declare global {
  interface Window {
    __ecobox?: typeof client;
  }
}
window.__ecobox = client;

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 挂载点');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
