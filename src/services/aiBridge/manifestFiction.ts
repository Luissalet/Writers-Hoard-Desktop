import type { BridgeTool } from './schema';

// Frozen from the incorporated API; no runtime imports.
export const FICTION_TOOLS: BridgeTool[] = [
  {
    "name": "clock_tick",
    "description": "Tick clock / avanzar reloj, marcar segmento, cuenta atrás.\n\nBy id, short ref like C1, or name, by\n`ticks` segments; negative ticks rewind. Clamped to the clock's size.\nReturns filled/segments, `full`, and what happens when full.\n\nKeywords: tick clock, advance clock, countdown, avanzar reloj, marcar segmento, cuenta atrás",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "clock": {
          "title": "Clock",
          "type": "string"
        },
        "ticks": {
          "default": 1,
          "title": "Ticks",
          "type": "integer"
        }
      },
      "required": [
        "world",
        "clock"
      ],
      "type": "object"
    }
  },
  {
    "name": "dice_roll",
    "description": "Roll dice / tirar dados, tirada, lanzar dados, prueba, dado.\n\nWrites the result to the audited log. Never invent a\nresult — always call this. Grammar: 2d6+3, 4d6kh3 (keep highest),\n2d20kl1, 3d6dl1, 1d6! (exploding), adv(d20), dis(d20), 4dF. Returns\ntotal, kept and dropped values and a log id. With `world`, the result\nis read by its ruleset: pbta_2d6 adds `band` (miss / weak_hit /\nstrong_hit) to a 2d6+N roll; d20 adds `natural` and `crit`.\n\nKeywords: roll dice, roll, check, saving throw, tirar dados, tirada, lanzar dados, prueba, dado",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "expression": {
          "title": "Expression",
          "type": "string"
        },
        "reason": {
          "default": "",
          "title": "Reason",
          "type": "string"
        },
        "world": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "World"
        },
        "who": {
          "default": "agent",
          "title": "Who",
          "type": "string"
        },
        "seed": {
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Seed"
        }
      },
      "required": [
        "expression"
      ],
      "type": "object"
    }
  },
  {
    "name": "entity_get",
    "description": "Get entity / ficha de personaje, detalles, quién es, cómo es.\n\nBy id, short ref (E3), name or alias: kind, status,\nsummary, description, fields (stats/traits), relations (with the other\nside's ref and name) and its 10 newest facts (`facts_has_more`).\nGM secrets only with include_secrets=true.\n\nKeywords: get entity, character sheet, details, ficha, ficha de personaje, detalles de, quién es, cómo es",
    "writes": false,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "ref": {
          "title": "Ref",
          "type": "string"
        },
        "include_secrets": {
          "default": false,
          "title": "Include Secrets",
          "type": "boolean"
        }
      },
      "required": [
        "world",
        "ref"
      ],
      "type": "object"
    }
  },
  {
    "name": "entity_upsert",
    "description": "Create or update entity / crear personaje, nuevo lugar, añadir objeto, actualizar.\n\nCreate an entity, or update the one with this name or alias. On\nupdate only the values you pass change: `fields` is merged into the\nexisting stats/traits, nothing you omit is cleared. `kind`: character,\nlocation, faction, item, lore, creature (must match an existing\nentity's kind). `status`: alive, dead, missing, destroyed, active,\nunknown (Spanish forms like \"muerta\" are accepted). `aliases` are\nnicknames the entity also answers to (\"la Ciega\"); `description` is the\nlong text, `tags` free labels. Returns the short entity with its ref\nand `created`.\n\nKeywords: create character, new location, update entity, add item, crear personaje, nuevo lugar, actualizar personaje, añadir objeto, cambiar estado",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "kind": {
          "title": "Kind",
          "type": "string"
        },
        "name": {
          "title": "Name",
          "type": "string"
        },
        "aliases": {
          "anyOf": [
            {
              "items": {
                "type": "string"
              },
              "type": "array"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Aliases"
        },
        "summary": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Summary"
        },
        "description": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Description"
        },
        "fields": {
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Fields"
        },
        "secrets": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Secrets"
        },
        "status": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Status"
        },
        "tags": {
          "anyOf": [
            {
              "items": {
                "type": "string"
              },
              "type": "array"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Tags"
        },
        "parent_id": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Parent Id"
        }
      },
      "required": [
        "world",
        "kind",
        "name"
      ],
      "type": "object"
    }
  },
  {
    "name": "scene_narrate",
    "description": "Narrate aloud / narrar en voz alta la escena, leer el turno, audio de la narración.\n\nReads one turn of a session (`session_id`; `turn` is its index or id,\ndefault the last narration, dialogue or action) with Prospero's voice\nthrough the hub, keeps the audio file with the turn and returns its\n`path` and `audio_url`. Needs the hub and Prospero's Hoard running;\nfails with voice_unavailable otherwise. `voice` and `lang` are optional.\n\nKeywords: narrate, read aloud, text to speech, narration audio, narrar escena, leer en voz alta, audio de la escena, voz del narrador",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "session_id": {
          "title": "Session Id",
          "type": "string"
        },
        "turn": {
          "anyOf": [
            {},
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Turn"
        },
        "voice": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Voice"
        },
        "lang": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Lang"
        },
        "world": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "World"
        }
      },
      "required": [
        "session_id"
      ],
      "type": "object"
    }
  },
  {
    "name": "session_export",
    "description": "Export / exportar capítulo de la sesión, biblia, copia de seguridad.\n\nAs text, a page at a time: a session as a Markdown chapter\n(pass `session` id or title), the world bible in Markdown (omit\n`session`; no secrets), or the full JSON dump (format=\"json\"). Returns\nup to `max_chars` (500-20000) from `offset`; when `truncated` is true,\ncall again with offset=next_offset.\n\nKeywords: export, chapter, bible, backup, exportar, capítulo, biblia del mundo, copia de seguridad",
    "writes": false,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "session": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Session"
        },
        "format": {
          "default": "md",
          "title": "Format",
          "type": "string"
        },
        "offset": {
          "default": 0,
          "title": "Offset",
          "type": "integer"
        },
        "max_chars": {
          "default": 6000,
          "title": "Max Chars",
          "type": "integer"
        }
      },
      "required": [
        "world"
      ],
      "type": "object"
    }
  },
  {
    "name": "session_rename",
    "description": "Rename session / cambiar el nombre de la sesión, renombrar partida.\n\nBy id or its current title (e.g. \"Session 1\"), to something you can\nrefer to later (\"La noche del faro\"). Returns the renamed session.\n\nKeywords: rename session, name session, retitle session, renombrar sesión, nombrar sesión, cambiar nombre de la sesión, cambiar el título de la sesión",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "session": {
          "title": "Session",
          "type": "string"
        },
        "title": {
          "title": "Title",
          "type": "string"
        }
      },
      "required": [
        "world",
        "session",
        "title"
      ],
      "type": "object"
    }
  },
  {
    "name": "session_start",
    "description": "Start session / empezar partida, iniciar sesión nueva.\n\nStarts a new session and makes it the world's current one, so the\nnext story_append and turn land there instead of piling onto\nwhatever session was current before — without this, everything ends\nup in \"Session 1\" forever and \"last night's chapter\" means the whole\ncampaign. An empty `title` gets a default numbered in the world's\nown language (\"Sesión 2\"); pass a real title to name it, e.g. \"La\nnoche del faro\". Returns the new session.\n\nKeywords: start session, new session, name the session, empezar sesión, nueva sesión, nombrar sesión, nueva partida",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "title": {
          "default": "",
          "title": "Title",
          "type": "string"
        }
      },
      "required": [
        "world"
      ],
      "type": "object"
    }
  },
  {
    "name": "story_append",
    "description": "Record turn / registrar turno, guardar escena, anotar lo que pasó.\n\nApplies what it changed, atomically and undoably.\n`role`: narration, action, dialogue, ooc, roll or system. `delta` keys\n(all optional; refer to things by id or exact name):\n{\"new_entities\": [{\"kind\": \"character\", \"name\": \"Nadia\", \"summary\": \"...\"}],\n \"entity_updates\": [{\"ref\": \"E3\", \"status\": \"dead\", \"fields\": {\"wounded\": true}}],\n \"new_facts\": [{\"text\": \"...\", \"entity_ids\": [\"E3\"], \"canon\": false}],\n \"relations\": [{\"a\": \"E1\", \"b\": \"E3\", \"type\": \"hates\"}],\n \"timeline_events\": [{\"summary\": \"...\", \"in_world_date\": \"...\", \"entity_ids\": [\"E1\"]}],\n \"thread_changes\": [{\"ref\": \"T2\", \"status\": \"advanced\", \"note\": \"...\"}],\n \"clock_ticks\": [{\"ref\": \"C1\", \"ticks\": 1}],\n \"scene\": {\"location\": \"E4\", \"present\": [\"E1\", \"E3\"], \"mood\": \"tense\"}}\nThe scene carries over between turns; send only what changes. Invalid\nitems (unknown ids, a dead character present, a duplicate name) come\nback in `rejected` with the reason; the rest is applied. Returns the\nturn id, the resulting scene and what was applied.\n\nKeywords: record turn, apply changes, save scene, log what happened, registrar turno, aplicar cambios, guardar escena, anotar lo que pasó",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "text": {
          "default": "",
          "title": "Text",
          "type": "string"
        },
        "role": {
          "default": "narration",
          "title": "Role",
          "type": "string"
        },
        "author": {
          "default": "agent",
          "title": "Author",
          "type": "string"
        },
        "delta": {
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Delta"
        },
        "scene": {
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Scene"
        },
        "rolls": {
          "anyOf": [
            {
              "items": {
                "type": "object"
              },
              "type": "array"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Rolls"
        }
      },
      "required": [
        "world"
      ],
      "type": "object"
    }
  },
  {
    "name": "story_undo",
    "description": "Undo / deshacer último turno, revertir, volver atrás.\n\nReverts the last live turn of the world's current session and\neverything its delta changed (created entities, facts, relations and\nthreads are removed; updated entities, clocks and threads get their\nprevious values). Call again to undo the turn before it. Returns the\nundone turn and the scene now in effect.\n\nKeywords: undo, revert, take back, deshacer, revertir, deshacer último turno, volver atrás",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        }
      },
      "required": [
        "world"
      ],
      "type": "object"
    }
  },
  {
    "name": "story_world_create",
    "description": "Create a new world / crear mundo nuevo, nueva campaña, empezar historia.\n\n`ruleset` is freeform, d20 or pbta_2d6 (it changes how dice_roll reads\nresults); `language` is es or en. Names must be unique.\n\nKeywords: new world, create world, new campaign, nuevo mundo, crear mundo, nueva campaña, empezar historia",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "name": {
          "title": "Name",
          "type": "string"
        },
        "genre": {
          "default": "",
          "title": "Genre",
          "type": "string"
        },
        "tone": {
          "default": "",
          "title": "Tone",
          "type": "string"
        },
        "premise": {
          "default": "",
          "title": "Premise",
          "type": "string"
        },
        "ruleset": {
          "default": "freeform",
          "title": "Ruleset",
          "type": "string"
        },
        "language": {
          "default": "es",
          "title": "Language",
          "type": "string"
        },
        "rules_text": {
          "default": "",
          "title": "Rules Text",
          "type": "string"
        },
        "style_notes": {
          "default": "",
          "title": "Style Notes",
          "type": "string"
        },
        "content_lines": {
          "items": {
            "type": "string"
          },
          "title": "Content Lines",
          "type": "array"
        },
        "content_veils": {
          "items": {
            "type": "string"
          },
          "title": "Content Veils",
          "type": "array"
        }
      },
      "required": [
        "name"
      ],
      "type": "object"
    }
  },
  {
    "name": "story_worlds",
    "description": "List worlds / qué mundos hay, listar mundos, campañas, historias.\n\nid, name, genre, ruleset, language, counts (entities, open threads,\nsessions) and the current session. Call this first to learn a world's\nid; every other tool takes `world` as that id or the world's exact name.\n\nKeywords: worlds, list worlds, campaigns, stories, mundos, listar mundos, qué mundos hay, campañas, historias",
    "writes": false,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {},
      "type": "object"
    }
  },
  {
    "name": "table_roll",
    "description": "Random table / tabla aleatoria, tirar en la tabla, encuentro aleatorio, rumor.\n\nBy id or name, resolving nested\n`[[Other Table]]` references. Returns the final `text` and the chain\nof tables rolled.\n\nKeywords: roll table, random table, random encounter, rumor, tabla aleatoria, tirar en la tabla, encuentro aleatorio, rumor",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "table": {
          "title": "Table",
          "type": "string"
        },
        "seed": {
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Seed"
        }
      },
      "required": [
        "world",
        "table"
      ],
      "type": "object"
    }
  },
  {
    "name": "thread_update",
    "description": "Update thread / actualizar hilo, resolver trama, avanzar trama, cerrar hilo.\n\nBy id, short ref like T2, or title: `status`\nopen, advanced, resolved or abandoned, and/or a `note` appended to its\nnotes. Returns the thread. To open a new thread, use story_append's\nthread_changes with {\"create\": true, \"title\": \"...\"}.\n\nKeywords: update thread, resolve plot, advance plot, actualizar hilo, resolver trama, avanzar trama, cerrar hilo",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "thread": {
          "title": "Thread",
          "type": "string"
        },
        "status": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Status"
        },
        "note": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Note"
        }
      },
      "required": [
        "world",
        "thread"
      ],
      "type": "object"
    }
  },
  {
    "name": "world_check",
    "description": "Check consistency / comprobar contradicción, continuidad, es coherente.\n\nBefore making a statement canon: a dead character acting,\na character somewhere other than where they were last seen, a relation\ncontradicting a tracked one, plus an LLM judge over matching facts when\na model is available (`llm_judge` says whether it ran). Every conflict\ncites the id it contradicts. `consistent: true` means no rule or fact\nobjected, not that the statement is proven.\n\nKeywords: check consistency, contradiction, continuity, comprobar, contradicción, es coherente, tiene sentido, continuidad",
    "writes": false,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "statement": {
          "title": "Statement",
          "type": "string"
        }
      },
      "required": [
        "world",
        "statement"
      ],
      "type": "object"
    }
  },
  {
    "name": "world_context",
    "description": "Scene brief / contexto de la escena, qué está pasando, resumen, dónde estamos.\n\nCall it before narrating. `brief` is the text to read: premise,\ncontent boundaries, the current\nlocation and who is present (status, traits, relations among them),\nthe most relevant established facts, open and advanced threads, clocks\nat least half full and the last turns, each tagged with an id (E1, F1,\nT1, C1) to cite. `focus` adds words to rank facts by (e.g. \"the\nlighthouse key\"). GM secrets appear, marked [GM], only with\ninclude_secrets=true. The brief never exceeds budget_chars (200-20000);\n`truncated` says whether something was left out.\n\nKeywords: scene brief, context, what is happening, recap, contexto, contexto de la escena, qué está pasando, resumen, dónde estamos",
    "writes": false,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "scene": {
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Scene"
        },
        "focus": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Focus"
        },
        "include_secrets": {
          "default": false,
          "title": "Include Secrets",
          "type": "boolean"
        },
        "budget_chars": {
          "default": 3000,
          "title": "Budget Chars",
          "type": "integer"
        }
      },
      "required": [
        "world"
      ],
      "type": "object"
    }
  },
  {
    "name": "world_export",
    "description": "Export world as JSON / exportar el mundo, pasar personajes y lugares a otra app.\n\nThe world's characters, places, factions, other things (items, lore,\ncreatures), relations and timeline events as one neutral hoard.world/1\ndocument, each with a `ref` and a `revision`, for another app (Writer's\ncodex, for one) to read. Never carries secrets, images, facts, threads,\nclocks or sessions. `world_id` is the id or exact name.\n\nKeywords: export world, world json, share world, send characters to writer, exportar mundo, pasar personajes a Writer, enviar el mundo, compartir mundo",
    "writes": false,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world_id": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "World Id"
        },
        "world": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "World"
        }
      },
      "type": "object"
    }
  },
  {
    "name": "world_import",
    "description": "Import world JSON / importar, trae el mundo, personajes y lugares de otra app (Writer).\n\nMerges a hoard.world/1 document (`data`, as `world_export` or another\napp produces it) into `world_id`, or into the world it was imported into\nbefore, or into a new world. Safe to repeat: new records are created,\nunchanged ones are skipped, a record edited here is never overwritten\n(reported as local_modified), an existing name is linked instead of\nduplicated, and nothing is ever deleted. Returns counts per state and\nthe first 100 records with their state.\n\nKeywords: import world, merge world, bring characters from writer, importar mundo, traer personajes de Writer, traer el mundo, fusionar mundo",
    "writes": true,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "data": {
          "title": "Data",
          "type": "object"
        },
        "world_id": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "World Id"
        }
      },
      "required": [
        "data"
      ],
      "type": "object"
    }
  },
  {
    "name": "world_search",
    "description": "Search / buscar, encontrar: quién es, dónde está, qué sabemos de.\n\nFind entities and established facts by words (accent-insensitive:\n\"corazon\" finds \"Corazón\"). A status word (\"muerto\", \"dead\",\n\"desaparecidos\", \"missing\") lists everyone in that state first, so\n\"¿quién ha muerto?\" is one call. `kinds` narrows entities to any of\ncharacter, location, faction, item, lore, creature. Returns up to\n`limit` (max 25) short hits of each with their ids, and `has_more`.\nSecrets are never included; use entity_get for one entity's details.\n\nKeywords: search, find, look up, who is, where is, who died, buscar, encontrar, quién es, dónde está, qué sabemos de, quién ha muerto",
    "writes": false,
    "group": "story",
    "timeoutMs": 300000,
    "schema": {
      "properties": {
        "world": {
          "title": "World",
          "type": "string"
        },
        "query": {
          "title": "Query",
          "type": "string"
        },
        "kinds": {
          "anyOf": [
            {
              "items": {
                "type": "string"
              },
              "type": "array"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Kinds"
        },
        "limit": {
          "default": 8,
          "title": "Limit",
          "type": "integer"
        }
      },
      "required": [
        "world",
        "query"
      ],
      "type": "object"
    }
  },
  {
    "name": "wh_story_modules",
    "description": "List independent fiction, narration, voice and illustration switches and data path. Does not start a worker\nor open a database.",
    "writes": false,
    "group": "core",
    "schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "wh_story_module_set",
    "description": "Switch fiction, narration, voice or illustrations on/off. All start OFF. Data directory can be selected while\nfiction is OFF. OFF closes its private worker.",
    "writes": true,
    "group": "core",
    "schema": {
      "type": "object",
      "properties": {
        "module": {
          "type": "string",
          "enum": [
            "fiction",
            "narration",
            "voice",
            "illustrations"
          ]
        },
        "enabled": {
          "type": "boolean"
        },
        "dataDir": {
          "type": "string"
        }
      },
      "required": [
        "module",
        "enabled"
      ]
    }
  }
];

export const FICTION_ANNOTATIONS: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean }> = {
  "story_worlds": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "story_world_create": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false
  },
  "world_context": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "world_search": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "entity_get": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "entity_upsert": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "story_append": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false
  },
  "dice_roll": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false
  },
  "table_roll": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false
  },
  "thread_update": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false
  },
  "clock_tick": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false
  },
  "world_check": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "session_start": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false
  },
  "session_rename": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "session_export": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "world_export": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "world_import": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "scene_narrate": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false
  },
  "story_undo": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false
  }
};

// Native session preparation is additive: the 19 incorporated contracts above stay frozen.
const sessionDetailProperties = {
  scheduled_at: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Scheduled instant in UTC Unix seconds; null clears it.' },
  timezone: { type: 'string', description: 'Time zone recorded alongside the scheduled instant.' },
  length_min: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
  place: { type: 'string' }, hook: { type: 'string' }, dm_notes: { type: 'string', description: 'Private GM notes; omitted from results by default.' },
  status: { type: 'string', enum: ['planned', 'live', 'played'] },
  recap: { type: 'string', description: 'Author-written recap. Editing returns a ready recap to draft unless explicitly marked ready again.' },
  recap_posted: { type: 'boolean', description: 'true marks a nonempty recap ready to share locally and the session played. Sends nothing.' },
  attendance: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', minLength: 1 },
    entity_id: { type: 'string', description: 'Optional character id belonging to this world.' }, present: { type: 'boolean' } },
    required: ['name', 'present'], additionalProperties: false } },
};
const sessionDetailsSchema = { type: 'object' as const, properties: sessionDetailProperties, additionalProperties: false };
FICTION_TOOLS.push(
  { name: 'wh_story_session_list', group: 'story', writes: false,
    description: 'Read session plans, dates, status, attendance and manually written recap drafts or ready recaps. Old sessions remain unclassified. Omit session for all; pass its id or title for one. DM notes are omitted unless include_dm_notes is true. Never creates or activates a session.',
    schema: { type: 'object', properties: { world: { type: 'string' }, session: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      include_dm_notes: { type: 'boolean', default: false } }, required: ['world'], additionalProperties: false } },
  { name: 'wh_story_session_create', group: 'story', writes: true,
    description: 'Plan a fiction session without changing the current play session. A new plan starts planned. Pass title and optional details: scheduled date, zone, duration, place, hook, private DM notes, attendance or recap draft. Start it later explicitly with wh_story_session_update status live. DM notes are omitted from the result; no model or external publication is used.',
    schema: { type: 'object', properties: { world: { type: 'string' }, title: { type: 'string' }, details: sessionDetailsSchema },
      required: ['world'], additionalProperties: false } },
  { name: 'wh_story_session_update', group: 'story', writes: true,
    description: 'Partially edit a fiction session by id or title. Omitted patch fields stay unchanged; null clears date/duration, empty strings clear text. status live selects it for new turns and completes the previous current session only if that session had preparation status live; legacy sessions are unchanged. played ends and deselects it if current; planned deselects it without clearing historical times. recap_posted true marks a nonempty author-written recap ready to share locally and the session played atomically. Editing recap returns it to draft. Sends nothing. DM notes are omitted from results.',
    schema: { type: 'object', properties: { world: { type: 'string' }, session: { type: 'string' }, patch: sessionDetailsSchema },
      required: ['world', 'session', 'patch'], additionalProperties: false } },
);
Object.assign(FICTION_ANNOTATIONS, {
  wh_story_session_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  wh_story_session_create: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  wh_story_session_update: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
});
