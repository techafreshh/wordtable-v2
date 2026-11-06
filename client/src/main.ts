import './styles/tokens.css'
import './styles/board.css'
import './styles/fx.css'
import { mountBoard } from './components/Board'

const app = document.getElementById('app')
if (app) {
  app.innerHTML =
    '<main class="table">' +
    '<h1 class="table-title">Wordtable</h1>' +
    '<div class="board-host"></div>' +
    '<div class="table-actions">' +
    '<button type="button" data-action="create">Create</button>' +
    '<button type="button" data-action="join">Join</button>' +
    '<button type="button" data-action="play">Play</button>' +
    '</div></main>'
  const host = app.querySelector<HTMLElement>('.board-host')
  if (host) mountBoard(host)
}
