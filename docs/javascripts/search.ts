interface SearchEntry { url: string; title: string; text: string }
const query = document.querySelector<HTMLInputElement>("#query")!;
const results = document.querySelector<HTMLUListElement>("#results")!;
const feedback = document.querySelector<HTMLElement>("[role=status]")!;
async function searchPage() {
  const response = await fetch("/search.json");
  if (!response.ok) throw new Error();
  const entries: SearchEntry[] = await response.json();
  function update() {
    const term = query.value.trim().toLocaleLowerCase();
    const matches = term ? entries.filter(p => (p.title + " " + p.text).toLocaleLowerCase().includes(term)) : [];
    feedback.textContent = term ? `검색 결과 ${matches.length}개` : "";
    results.replaceChildren(...matches.map(p => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = p.url;
      link.textContent = p.title;
      li.append(link);
      return li;
    }));
  }
  query.addEventListener("input", update);
  update();
}
searchPage().catch(() => { feedback.textContent = "검색 목록을 불러오지 못했습니다."; });

