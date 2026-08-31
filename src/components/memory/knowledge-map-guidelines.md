# Knowledge Map Rules

## 1. Keep functions short

Good:

```ts
const zoomIn = () => setView((current) => ({ ...current, k: current.k * 1.2 }));
```

Bad:

```ts
function zoomIn() {
  const next = { ...view };
  next.k = next.k * 1.2;
  next.x = next.x + 1;
  next.y = next.y + 1;
  setView(next);
}
```

## 2. Prefer arrows unless a library asks otherwise

Good:

```ts
const selectNode = (id: string) => setSelectedId(id);
```

Bad:

```ts
function selectNode(id: string) {
  setSelectedId(id);
}
```

## 3. Make state explicit

Good:

```ts
const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
```

Bad:

```ts
const selectedNode = nodes[selectedIndex];
```

## 4. Surface failures plainly

Good:

```ts
return <p>知识图谱加载失败</p>;
```

Bad:

```ts
return <p>Something went wrong.</p>;
```
