interface SearchEntry { url: string; title: string; text: string }
const query = document.querySelector<HTMLInputElement>("#query")!;
const results = document.querySelector<HTMLUListElement>("#results")!;
const feedback = document.querySelector<HTMLElement>("[role=status]")!;
query.value = new URL(location.href).searchParams.get("q") ?? "";
async function searchPage() {
  const response = await fetch("/search.json");
  if (!response.ok) throw new Error();
  const entries: SearchEntry[] = await response.json();
  function update() {
    const term = query.value.trim().toLocaleLowerCase();
    const matches = term ? entries.filter(p => (p.title + " " + p.text).toLocaleLowerCase().includes(term)) : [];
    matches.sort((a, b) => Number(b.title.toLocaleLowerCase().includes(term)) - Number(a.title.toLocaleLowerCase().includes(term)));
    feedback.textContent = term && !matches.length ? "일치하는 글이 없습니다. 다른 검색어를 입력해 보세요." : term ? `검색 결과 ${matches.length}개` : "";
    results.replaceChildren(...matches.map(p => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = p.url;
      link.textContent = p.title;
      const firstMatch = p.text.toLocaleLowerCase().indexOf(term);
      const start = Math.max(0, firstMatch - 28);
      const excerpt = document.createElement("p");
      excerpt.textContent = (start ? "…" : "") + p.text.slice(start, start + 110).trim() + (start + 110 < p.text.length ? "…" : "");
      li.append(link, excerpt);
      return li;
    }));
  }
  query.addEventListener("input", () => {
    const url = new URL(location.href);
    if (query.value.trim()) url.searchParams.set("q", query.value.trim());
    else url.searchParams.delete("q");
    history.replaceState(null, "", url);
    update();
  });
  update();
}
searchPage().catch(() => { feedback.textContent = "검색 목록을 불러오지 못했습니다."; });

