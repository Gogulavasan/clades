import './ui/styles.css';
import './ui/screens.css';
import { mountShell } from './ui/shell';

const root = document.getElementById('app');
if (!root) throw new Error('CLADES: #app element missing from index.html');
mountShell(root);
