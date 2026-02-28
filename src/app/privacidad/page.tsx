export const dynamic = "force-dynamic"

export default function PrivacidadPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Política de Privacidad</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-8">Última actualización: 2026</p>

        <div className="space-y-8 text-sm text-gray-700 dark:text-slate-300 leading-relaxed">

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">1. Marco legal aplicable</h2>
            <p>
              PsicoApp opera en cumplimiento de la <strong>Ley 25.326 de Protección de Datos Personales</strong> (Argentina),
              la <strong>Ley 26.529 de Derechos del Paciente</strong>, y la <strong>Ley 17.132</strong> que regula el ejercicio
              de la medicina y sus profesiones auxiliares. El profesional que utiliza esta plataforma es el responsable del
              tratamiento de los datos de sus pacientes.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">2. Datos que se procesan</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Nombre, edad y motivo de consulta del paciente (ingresados por el profesional)</li>
              <li>Notas clínicas y transcripciones de audio (generadas y/o ingresadas por el profesional)</li>
              <li>Análisis automáticos generados por inteligencia artificial como apoyo clínico</li>
              <li>Datos de pago de sesiones (montos y estado, sin datos de tarjeta)</li>
              <li>Datos de acceso del profesional (email, sesión autenticada)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">3. Finalidad del tratamiento</h2>
            <p>Los datos se utilizan exclusivamente para:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Gestión clínica de pacientes por parte del profesional</li>
              <li>Generación de resúmenes y análisis asistidos por IA como herramienta de apoyo</li>
              <li>Registro de pagos y gestión del consultorio</li>
            </ul>
            <p className="mt-3">Los datos <strong>no se comparten con terceros</strong> con fines comerciales ni se utilizan para entrenar modelos de IA propios.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">4. Consentimiento para grabación de audio</h2>
            <p>
              Toda grabación de audio de sesiones requiere el consentimiento informado y expreso del paciente, conforme al
              <strong> artículo 2° de la Ley 26.529</strong>. El profesional es responsable de obtener y registrar dicho consentimiento
              antes de proceder a la grabación. La plataforma registra la fecha en que el consentimiento fue confirmado por el profesional.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">5. Seguridad de los datos</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Los datos se almacenan en Supabase con encriptación en reposo (AES-256)</li>
              <li>Las comunicaciones se realizan exclusivamente mediante HTTPS/TLS</li>
              <li>Cada profesional solo puede acceder a sus propios datos mediante Row Level Security (RLS)</li>
              <li>Los archivos de audio se almacenan en buckets privados de Supabase Storage</li>
              <li>Las claves de API y credenciales nunca se exponen al cliente</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">6. Derechos del titular de los datos</h2>
            <p>Conforme al <strong>artículo 14 de la Ley 25.326</strong>, el titular tiene derecho a:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Acceso:</strong> El profesional puede exportar todos los datos de un paciente desde su ficha</li>
              <li><strong>Rectificación:</strong> Los datos pueden modificarse en cualquier momento</li>
              <li><strong>Supresión:</strong> El profesional puede eliminar permanentemente los datos de un paciente desde su ficha</li>
              <li><strong>Portabilidad:</strong> Los expedientes pueden exportarse en formato HTML/PDF</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">7. Uso de inteligencia artificial</h2>
            <p>
              Los análisis generados por IA (resúmenes, hipótesis, métricas clínicas) son herramientas de apoyo para el profesional.
              <strong> No constituyen diagnósticos clínicos</strong> y no reemplazan el juicio profesional del psicólogo.
              El procesamiento de texto para análisis se realiza a través de la API de OpenAI bajo sus propios términos de privacidad.
              No se almacena información identificable de pacientes en los sistemas de OpenAI.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">8. Confidencialidad y secreto profesional</h2>
            <p>
              La información clínica está protegida por el secreto profesional conforme al <strong>artículo 11 de la Ley 17.132</strong>.
              El profesional es el único responsable del manejo ético y legal de los datos de sus pacientes.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">9. Retención de datos</h2>
            <p>
              Los datos se conservan mientras el profesional mantenga una cuenta activa. Al eliminar un paciente, sus datos
              se suprimen de forma permanente. Al solicitar la eliminación de la cuenta, todos los datos asociados serán eliminados.
            </p>
          </section>

          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl p-4 text-xs text-blue-800 dark:text-blue-300">
            Para consultas sobre privacidad o ejercicio de derechos, el profesional puede contactar al administrador de la plataforma.
            La Dirección Nacional de Protección de Datos Personales (DNPDP) es la autoridad de aplicación de la Ley 25.326.
          </div>

        </div>
      </div>
    </div>
  )
}
