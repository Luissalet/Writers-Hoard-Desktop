// The guided tours, as data. Spanish (Spain) and English side by side so a
// missing translation is visible in the same diff. Every `anchor` is a
// `data-tour` attribute that exists in the real UI (tests/guided-tours checks
// each one against the source); a step whose anchor is not on screen is
// skipped at run time, so a stale anchor costs a step, never a crash.

import type { TourDefinition } from './tourTypes';

export const TOURS: readonly TourDefinition[] = [
  {
    id: 'first-world',
    title: { es: 'Tu primer mundo', en: 'Your first world' },
    summary: {
      es: 'Crear un mundo y moverte por la aplicación.',
      en: 'Create a world and find your way around.',
    },
    needsProject: false,
    steps: [
      {
        id: 'new-world', anchor: 'dashboard-new-project', route: 'home',
        title: { es: 'Crea un mundo', en: 'Create a world' },
        text: {
          es: 'Un mundo es un proyecto: su manuscrito, sus fichas, mapas y cronologías viven juntos. Pulsa aquí para crear el primero.',
          en: 'A world is a project: its manuscript, cards, maps and timelines live together. Press here to create the first one.',
        },
      },
      {
        id: 'sidebar', anchor: 'sidebar',
        title: { es: 'La barra lateral', en: 'The sidebar' },
        text: {
          es: 'Al abrir un mundo, aquí aparecen sus herramientas. Puedes plegarla o esconderla cuando necesites espacio.',
          en: 'When you open a world, its tools appear here. You can fold it or hide it when you need room.',
        },
      },
      {
        id: 'capture', anchor: 'topbar-capture',
        title: { es: 'Captura una idea', en: 'Capture an idea' },
        text: {
          es: 'Apunta una idea al vuelo sin salir de lo que estás haciendo. Se guarda en la bandeja de notas.',
          en: 'Jot an idea down without leaving what you are doing. It goes into the notes inbox.',
        },
      },
      {
        id: 'search', anchor: 'topbar-search',
        title: { es: 'Busca en todo', en: 'Search everything' },
        text: {
          es: 'El buscador encuentra fichas, capítulos, mapas y también lanza acciones. Tiene su propio atajo de teclado.',
          en: 'Search finds cards, chapters and maps, and also runs actions. It has its own keyboard shortcut.',
        },
      },
      {
        id: 'workspace', anchor: 'project-workspace', route: 'overview',
        title: { es: 'El espacio de trabajo', en: 'The workspace' },
        text: {
          es: 'Aquí puedes abrir una segunda herramienta junto a la principal, por ejemplo la ficha de un personaje al lado del capítulo.',
          en: 'Here you can open a second tool beside the main one, for example a character card next to the chapter.',
        },
      },
      {
        id: 'library', anchor: 'workspace-library',
        title: { es: 'La biblioteca', en: 'The library' },
        text: {
          es: 'Todos los documentos del mundo en un solo lugar, ordenables en carpetas. Ábrelos en la vista principal o al lado.',
          en: 'Every document of the world in one place, sortable into folders. Open them in the main view or beside it.',
        },
      },
    ],
  },
  {
    id: 'first-card',
    title: { es: 'Tu primera ficha', en: 'Your first card' },
    summary: {
      es: 'Crear una ficha en el Códice, a mano o con la guiada.',
      en: 'Make a card in the Codex, by hand or guided.',
    },
    needsProject: true,
    steps: [
      {
        id: 'nav', anchor: 'nav-codex', route: 'engine:codex',
        title: { es: 'El Códice', en: 'The Codex' },
        text: {
          es: 'Aquí viven los personajes, lugares, objetos y todo lo que tu historia necesita recordar.',
          en: 'Characters, places, objects and everything your story needs to remember live here.',
        },
      },
      {
        id: 'view', anchor: 'codex-view-toggle',
        title: { es: 'Fichas o grafo', en: 'Cards or graph' },
        text: {
          es: 'Alterna entre la lista de fichas y el grafo, que dibuja cómo se relacionan entre sí.',
          en: 'Switch between the list of cards and the graph, which draws how they relate to each other.',
        },
      },
      {
        id: 'new', anchor: 'codex-new-entry',
        title: { es: 'Nueva ficha', en: 'New card' },
        text: {
          es: 'Pulsa aquí, elige el tipo (personaje, lugar…) y ponle nombre. Lo demás se puede rellenar más tarde.',
          en: 'Press here, pick the type (character, place…) and give it a name. The rest can be filled in later.',
        },
      },
      {
        id: 'guided', anchor: 'codex-guided',
        title: { es: 'Ficha guiada', en: 'Guided card' },
        text: {
          es: 'Si no sabes por dónde empezar, la ficha guiada te hace preguntas y rellena los campos por ti.',
          en: 'If you do not know where to start, the guided card asks you questions and fills the fields for you.',
        },
      },
    ],
  },
  {
    id: 'first-map',
    title: { es: 'Tu primer mapa', en: 'Your first map' },
    summary: {
      es: 'Subir una imagen, colocar chinchetas y gestionar tus mapas.',
      en: 'Add an image, drop pins and manage your maps.',
    },
    needsProject: true,
    steps: [
      {
        id: 'nav', anchor: 'nav-maps', route: 'engine:maps',
        title: { es: 'Mapas', en: 'Maps' },
        text: {
          es: 'La herramienta de mapas. Si no la ves en la barra, el recorrido «Activar herramientas» te enseña a encenderla.',
          en: 'The maps tool. If you do not see it in the sidebar, the "Turn on tools" tour shows you how to switch it on.',
        },
      },
      {
        id: 'view', anchor: 'maps-view',
        title: { es: 'El lienzo', en: 'The canvas' },
        text: {
          es: 'Sube la imagen de tu mapa y coloca chinchetas con nombre y descripción en los lugares que importan.',
          en: 'Upload your map image and drop pins with a name and description on the places that matter.',
        },
      },
      {
        id: 'list', anchor: 'maps-list',
        title: { es: 'Tus mapas', en: 'Your maps' },
        text: {
          es: 'Aquí creas mapas nuevos, cambias de uno a otro y borras los que ya no quieras.',
          en: 'Create new maps here, switch between them and delete the ones you no longer want.',
        },
      },
    ],
  },
  {
    id: 'timeline',
    title: { es: 'La cronología', en: 'The timeline' },
    summary: {
      es: 'Ordenar sucesos, cambiar de vista y fijar el calendario del mundo.',
      en: 'Order events, change view and set the world calendar.',
    },
    needsProject: true,
    steps: [
      {
        id: 'nav', anchor: 'nav-timeline', route: 'engine:timeline',
        title: { es: 'Cronología', en: 'Timeline' },
        text: {
          es: 'Los sucesos de tu historia en orden, con las fechas del calendario de tu mundo.',
          en: 'The events of your story in order, with dates from your own world calendar.',
        },
      },
      {
        id: 'views', anchor: 'timeline-view-toggle',
        title: { es: 'Tres vistas', en: 'Three views' },
        text: {
          es: 'Carriles para ver varias líneas a la vez, lista para repasar, y calendario para ver cada suceso en su día.',
          en: 'Lanes to see several lines at once, a list to review, and a calendar to see each event on its day.',
        },
      },
      {
        id: 'calendar', anchor: 'timeline-calendar',
        title: { es: 'El calendario del mundo', en: 'The world calendar' },
        text: {
          es: 'Define meses, días y eras propios. Las fechas de todos los sucesos se escriben en este calendario.',
          en: 'Define your own months, days and eras. Every event date is written in this calendar.',
        },
      },
      {
        id: 'list', anchor: 'timeline-list',
        title: { es: 'Tus cronologías', en: 'Your timelines' },
        text: {
          es: 'Puedes llevar varias cronologías (la historia, la del villano, la del mundo) y crear otra desde aquí.',
          en: 'You can keep several timelines (the plot, the villain, the world) and create another from here.',
        },
      },
    ],
  },
  {
    id: 'board',
    title: { es: 'El tablero', en: 'The board' },
    summary: {
      es: 'Un lienzo libre para atar ideas, fichas y notas.',
      en: 'A free canvas to tie ideas, cards and notes together.',
    },
    needsProject: true,
    steps: [
      {
        id: 'nav', anchor: 'nav-board', route: 'engine:board',
        title: { es: 'Tablero', en: 'Board' },
        text: {
          es: 'Un corcho de investigación: pon fichas, notas e imágenes y únelas con flechas.',
          en: 'A research corkboard: place cards, notes and images and join them with arrows.',
        },
      },
      {
        id: 'boards', anchor: 'board-list',
        title: { es: 'Tus tableros', en: 'Your boards' },
        text: {
          es: 'Cambia de tablero o crea otro. Haz doble clic en el nombre de uno para renombrarlo.',
          en: 'Switch boards or create another. Double-click a board name to rename it.',
        },
      },
      {
        id: 'canvas', anchor: 'board-canvas',
        title: { es: 'El lienzo', en: 'The canvas' },
        text: {
          es: 'Aquí colocas y unes lo que quieras. Con el botón derecho sobre el fondo o sobre un elemento ves lo que puedes hacer.',
          en: 'Place and join whatever you like here. Right-click the background or an item to see what you can do.',
        },
      },
    ],
  },
  {
    id: 'enable-tools',
    title: { es: 'Activar herramientas', en: 'Turn on tools' },
    summary: {
      es: 'Encender o apagar herramientas en un mundo sin perder datos.',
      en: 'Switch tools on or off in a world without losing data.',
    },
    needsProject: true,
    steps: [
      {
        id: 'open', anchor: 'sidebar-manage-engines', route: 'overview', toolManager: false,
        title: { es: 'Gestionar herramientas', en: 'Manage tools' },
        text: {
          es: 'Cada mundo enseña solo las herramientas que usa. Este botón abre el gestor.',
          en: 'Each world shows only the tools it uses. This button opens the manager; in this tour we open it for you.',
        },
      },
      {
        id: 'preset', anchor: 'engine-manager-preset', toolManager: true,
        title: { es: 'Un punto de partida', en: 'A starting point' },
        text: {
          es: 'Ya lo hemos abierto. Los modos (novela, juego de rol, investigación…) activan de golpe un conjunto de herramientas. Te dice qué añadiría y qué quitaría antes de cambiar nada.',
          en: 'We opened it for you. Modes (novel, role-playing, research…) switch on a set of tools at once. It tells you what it would add and remove before changing anything.',
        },
      },
      {
        id: 'search', anchor: 'engine-manager-search',
        title: { es: 'Busca una herramienta', en: 'Find a tool' },
        text: {
          es: 'Escribe lo que necesitas (mapa, tabla, diario…) para filtrar las dos listas de abajo.',
          en: 'Type what you need (map, table, diary…) to filter the two lists below.',
        },
      },
      {
        id: 'active', anchor: 'engine-manager-active',
        title: { es: 'Las que ya usas', en: 'The ones you use' },
        text: {
          es: 'El orden de esta lista es el de la barra lateral: arrastra para cambiarlo. Quitar una herramienta no borra sus datos.',
          en: 'The order of this list is the sidebar order: drag to change it. Removing a tool does not delete its data.',
        },
      },
      {
        id: 'available', anchor: 'engine-manager-available',
        title: { es: 'Las que puedes añadir', en: 'The ones you can add' },
        text: {
          es: 'Pulsa una para activarla. Aparecerá en la barra lateral cuando guardes.',
          en: 'Press one to switch it on. It appears in the sidebar once you save.',
        },
      },
      {
        id: 'save', anchor: 'engine-manager-save',
        title: { es: 'Guarda los cambios', en: 'Save the changes' },
        text: {
          es: 'Hasta que guardes no cambia nada. Cancelar lo deja todo como estaba.',
          en: 'Nothing changes until you save. Cancel leaves everything as it was.',
        },
      },
    ],
  },
  {
    id: 'wiki-edition',
    title: { es: 'Publicar una edición de la wiki', en: 'Publish a wiki edition' },
    summary: {
      es: 'Convertir tu Códice en una wiki que se abre sin la aplicación.',
      en: 'Turn your Codex into a wiki that opens without the app.',
    },
    needsProject: true,
    steps: [
      {
        id: 'export', anchor: 'codex-wiki-export', route: 'engine:codex', toolManager: false,
        title: { es: 'Exportar la wiki', en: 'Export the wiki' },
        text: {
          es: 'Este desplegable prepara una wiki con tus fichas y mapas: un archivo que se abre en cualquier navegador, sin conexión.',
          en: 'This drop-down prepares a wiki with your cards and maps: a file that opens in any browser, offline.',
        },
      },
      {
        id: 'profiles', anchor: 'wiki-profiles', openDetails: 'codex-wiki-export',
        title: { es: 'Perfiles', en: 'Profiles' },
        text: {
          es: 'Un perfil guarda una configuración (qué incluir, el aspecto, el idioma). Puedes tener uno para lectores y otro para ti.',
          en: 'A profile keeps a configuration (what to include, the look, the language). You can have one for readers and one for yourself.',
        },
      },
      {
        id: 'contents', anchor: 'wiki-contents', openDetails: 'codex-wiki-export',
        title: { es: 'Qué incluir', en: 'What to include' },
        text: {
          es: 'Marca los tipos de ficha que irán a la wiki. Lo que quieras mantener en secreto, déjalo fuera aquí.',
          en: 'Tick the card types that go into the wiki. Anything you want to keep secret, leave out here.',
        },
      },
      {
        id: 'actions', anchor: 'wiki-actions', openDetails: 'codex-wiki-export',
        title: { es: 'Vista previa y descarga', en: 'Preview and download' },
        text: {
          es: 'Mira primero la vista previa y luego descarga. Con un perfil guardado también puedes publicar una edición y ver qué ha cambiado desde la anterior.',
          en: 'Look at the preview first, then download. With a saved profile you can also publish an edition and see what changed since the last one.',
        },
      },
    ],
  },
  {
    id: 'backups',
    title: { es: 'Copias de seguridad', en: 'Backups' },
    summary: {
      es: 'Guardar y restaurar tu trabajo en un archivo.',
      en: 'Save and restore your work to a file.',
    },
    needsProject: false,
    steps: [
      {
        id: 'status', anchor: 'dashboard-backup-status', route: 'home',
        title: { es: 'El estado de tu copia', en: 'Your backup status' },
        text: {
          es: 'Dice cuándo fue la última copia automática y la hace al pulsarlo. Se pone ámbar cuando toca otra y roja si falló.',
          en: 'Shows when the last automatic backup ran and makes one when pressed. It turns amber when one is due and red if it failed.',
        },
      },
      {
        id: 'full', anchor: 'dashboard-backup-full',
        title: { es: 'Copia completa', en: 'Full backup' },
        text: {
          es: 'Un solo archivo con todos tus mundos. Guárdalo fuera de este ordenador.',
          en: 'One file with all your worlds. Keep it somewhere outside this computer.',
        },
      },
      {
        id: 'restore', anchor: 'dashboard-backup-restore',
        title: { es: 'Restaurar', en: 'Restore' },
        text: {
          es: 'Carga un archivo de copia completa. Si algo ya existe, la aplicación te pregunta qué hacer antes de tocarlo.',
          en: 'Loads a full backup file. If something already exists, the app asks what to do before touching it.',
        },
      },
      {
        id: 'world', anchor: 'sidebar-export', route: 'overview',
        title: { es: 'Copia de un solo mundo', en: 'Back up one world' },
        text: {
          es: 'Dentro de un mundo, este botón guarda solo ese mundo en un archivo ZIP que puedes volver a importar.',
          en: 'Inside a world, this button saves just that world as a ZIP file you can import again.',
        },
      },
    ],
  },
  {
    id: 'first-chapter',
    title: { es: 'Tu primer capítulo', en: 'Your first chapter' },
    summary: {
      es: 'Empezar a escribir en el manuscrito.',
      en: 'Start writing in the manuscript.',
    },
    needsProject: true,
    steps: [
      {
        id: 'nav', anchor: 'nav-writings', route: 'engine:writings',
        title: { es: 'Manuscrito', en: 'Manuscript' },
        text: {
          es: 'Tus capítulos y escritos, en orden de lectura.',
          en: 'Your chapters and writings, in reading order.',
        },
      },
      {
        id: 'new', anchor: 'writings-new',
        title: { es: 'Un capítulo nuevo', en: 'A new chapter' },
        text: {
          es: 'Pulsa aquí, ponle título y empieza.',
          en: 'Press here, give it a title and begin.',
        },
      },
      {
        id: 'editor', anchor: 'editor-surface',
        title: { es: 'El editor', en: 'The editor' },
        text: {
          es: 'Escribe con libertad. Con «/» al principio de una línea se abre el menú de bloques (imágenes, tablas, notas…). Este paso solo aparece con un capítulo abierto.',
          en: 'Write freely. Typing "/" at the start of a line opens the block menu (images, tables, notes…). This step only appears with a chapter open.',
        },
      },
    ],
  },
];

export function findTour(id: string): TourDefinition | undefined {
  return TOURS.find(tour => tour.id === id);
}
