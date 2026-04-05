import TemperatureChart from './components/TemperatureChart'

function App() {
  return (
    <main className="min-h-screen px-5 py-8 text-slate-950 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/60 bg-white/70 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur xl:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-teal-800">
                Sensores-Temperatura-laboratorio
              </span>
              <h1 className="mt-5 max-w-3xl text-4xl font-extrabold tracking-[-0.04em] text-slate-950 sm:text-5xl">
                Dashboard de Laboratorio
                <span className="block text-teal-800">Control de Temperatura</span>
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                Visualiza en tiempo real el comportamiento termico de las peceras,
                detecta cambios anomalos y revisa el historial reciente en una sola vista.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-950 px-5 py-4 text-white">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                  Fuente de datos
                </p>
                <p className="mt-2 text-lg font-semibold">Supabase conectado</p>
              </div>
              <div className="rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4 text-orange-950">
                <p className="text-xs uppercase tracking-[0.2em] text-orange-700">
                  Estado inicial
                </p>
                <p className="mt-2 text-lg font-semibold">Mock data de las ultimas 48 horas</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/60 bg-white/75 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6">
          <TemperatureChart />
        </section>
      </div>
    </main>
  )
}

export default App
