/**
 * U0 : useToast() — émet une notification fugace (4 s), usage limité à
 * trois cas : copie, téléchargement lancé, préférence enregistrée.
 */
export function useToast() {
    const toast = useState('ui-toast', () => ({ text: '', icon: '' }))
    return {
        show: (text, icon = 'check') => { toast.value = { text, icon } },
        hide: () => { toast.value = { text: '', icon: '' } },
    }
}
