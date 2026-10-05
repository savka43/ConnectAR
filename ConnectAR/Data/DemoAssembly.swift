import Foundation

// Curated prototype content, not recognition output.
enum DemoAssembly {
    static let board = Motherboard(
        id: "msi-b550-a-pro",
        name: "MSI B550-A PRO",
        manualURL: URL(string: "https://download.msi.com/archive/mnu_exe/mb/B550-APRO_EN.pdf")!,
        steps: [
            AssemblyStep(id: "ram", title: "Установить память",
                connector: BoardConnector(id: "dimma2", name: "DIMMA2",
                    component: PCComponent(id: "ram", name: "Оперативная память DDR4", symbol: "memorychip")),
                instruction: "Для одного модуля используйте DIMMA2. Совместите вырез модуля с ключом слота.", manualPage: 28),
            AssemblyStep(id: "gpu", title: "Установить видеокарту",
                connector: BoardConnector(id: "pci-e1", name: "PCI_E1",
                    component: PCComponent(id: "gpu", name: "Видеокарта", symbol: "pc")),
                instruction: "Для одной видеокарты используйте PCI_E1. Закрепите карту в корпусе; дополнительное питание проверяйте по её инструкции.", manualPage: 29),
            AssemblyStep(id: "sata", title: "Подключить накопитель",
                connector: BoardConnector(id: "sata1", name: "SATA_1",
                    component: PCComponent(id: "ssd", name: "SATA-накопитель", symbol: "internaldrive")),
                instruction: "Соедините накопитель с SATA_1 кабелем данных. Накопителю также требуется отдельное питание от блока питания.", manualPage: 30),
            AssemblyStep(id: "atx", title: "Подключить питание платы",
                connector: BoardConnector(id: "atx", name: "ATX_PWR1",
                    component: PCComponent(id: "psu-atx", name: "Кабель ATX 24-pin", symbol: "bolt")),
                instruction: "Подключите основной 24-контактный кабель питания к ATX_PWR1, совместив ключи и защёлку.", manualPage: 34),
            AssemblyStep(id: "cpu-power", title: "Подключить питание процессора",
                connector: BoardConnector(id: "cpu-power", name: "CPU_PWR1",
                    component: PCComponent(id: "psu-cpu", name: "Кабель CPU / EPS 8-pin", symbol: "bolt")),
                instruction: "Подключите кабель CPU / EPS к CPU_PWR1. Кабель PCIe для видеокарты сюда не подходит.", manualPage: 34)
        ])
}
