import './styles/tokens.css'
import './styles/board.css'
import './styles/fx.css'

const app = document.getElementById('app')
if (app) {
  app.innerHTML =
    '<main class="start-screen" style="text-align:center;margin-top:3rem;font-family:var(--font-stack)">' +
    '<h1 style="color:var(--ivory)">Wordtable</h1>' +
    '<div style="display:flex;gap:0.75rem;justify-content:center;margin-top:1.5rem">' +
    '<button type="button" data-action="create" style="background:var(--brass);color:var(--wood-dark);border-radius:var(--radius-md);padding:0.6rem 1.4rem;border:none;cursor:pointer">Create</button>' +
    '<button type="button" data-action="join" style="background:var(--brass);color:var(--wood-dark);border-radius:var(--radius-md);padding:0.6rem 1.4rem;border:none;cursor:pointer">Join</button>' +
    '<button type="button" data-action="play" style="background:var(--felt-bright);color:var(--ivory);border-radius:var(--radius-md);padding:0.6rem 1.4rem;border:none;cursor:pointer">Play</button>' +
    '</div></main>'
}
