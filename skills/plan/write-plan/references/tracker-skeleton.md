# The tracker's skeleton

Copy the block, replace every phrase, delete what the plan has no use for. Keep the caption
line above the fence and the mandate line under it. Unless `tests: at the plan end`, delete
the tests phase; unless `verify:` is on, the validation phase.

Phasing diagram: the phases, every seat's task in each, and what each phase has to show before the next opens.

```mermaid
flowchart TB
  %% tracker
  ST["📍 state · 2026-01-01<br/>branch: feat/topic @ 0000000, not pushed<br/>deployed: nothing yet<br/>next: S11.1, S12.1, S13.1, S14.1<br/>blocked: nothing<br/>parked: nothing"]
  GO(["phase 1 opens · its tasks posted"])

  subgraph SL11["P1 · seat1 · US1 · the riskiest part"]
    S11.1["▶ S11.1 the outcome · US1<br/>done when: the command exits 0"]
  end
  subgraph SL12["P1 · seat2 · US2 · the api"]
    S12.1["▶ S12.1 the outcome<br/>done when: the command exits 0"]
  end
  subgraph SL13["P1 · seat3 · US2 · the store"]
    S13.1["▶ S13.1 the outcome<br/>done when: the command exits 0"]
  end
  subgraph SL14["P1 · seat4 · US1 · the screen"]
    S14.1["▶ S14.1 the outcome<br/>done when: the command exits 0"]
  end

  subgraph SL20["P2 · seat1–seat4 · the tests"]
    S20.1["⬜ S20.1 tasks posted at the phase's open<br/>done when: the full check exits 0 on the merged branch"]
  end

  subgraph SL30["P3 · validator alone · validation"]
    S30.1["⬜ S30.1 the validator walks the merged result<br/>done when: its verdict has no blocker"]
  end

  subgraph SL40["the check on dev · 👤"]
    G4{"the person: does it do what US2 says?"}
    S40.1["⬜ S40.1 the person looked at dev · 👤 · US2<br/>done when: their word, quoted"]
  end

  ST ~~~ GO
  GO --> S11.1 & S12.1 & S13.1 & S14.1
  S11.1 & S12.1 & S13.1 & S14.1 -->|"phase 1 merged, check green"| S20.1
  S20.1 -->|"phase 2 merged, check green"| S30.1
  S30.1 --> G4
  G4 -->|"yes"| S40.1
  G4 -->|"no: back to the plan"| S30.1

  classDef done stroke:#4a9d5f,stroke-width:2px,fill:#7f7f7f1a
  classDef next stroke:#d08b28,stroke-width:2px,fill:#7f7f7f1a
  classDef todo stroke-dasharray:4 3
  classDef state stroke:#8a8a8a,stroke-width:1px,fill:#7f7f7f12
  class S11.1,S12.1,S13.1,S14.1 next
  class S20.1,S30.1,S40.1 todo
  class ST state
```

mandate: seats 4 · phases 3 · verify at the end · run through · opus · medium · tests at the plan end
