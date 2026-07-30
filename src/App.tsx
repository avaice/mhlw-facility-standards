export function App() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">医療機関 施設基準検索</h1>
      </header>
      <main>
        <div className="flex gap-2">
          <input
            className="w-full p-3 border border-gray-300 rounded-md text-lg"
            type="text"
            placeholder="医療機関名または10桁の医療機関コードを入力"
          />
          <button className="p-3 bg-blue-500 text-white rounded-md hover:bg-blue-600 shrink-0 w-16">
            検索
          </button>
        </div>
      </main>
    </div>
  );
}
