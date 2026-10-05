import Foundation

// Curated prototype content, not recognition output.
// Source of truth: shared_boards/boards/gigabyte-b450-aorus-m/board.json — keep in sync.
enum DemoAssembly {
    static let board = Motherboard(
        id: "gigabyte-b450-aorus-m",
        name: "Gigabyte B450 AORUS M",
        manualURL: URL(string: "https://download.gigabyte.com/FileList/Manual/mb_manual_b450-aorus-m_1102_210615_e.pdf")!,
        steps: [
            AssemblyStep(id: "ram", title: "Установить память",
                connector: BoardConnector(id: "ddr4-1", name: "DDR4_1",
                    component: PCComponent(id: "ram", name: "Оперативная память DDR4", symbol: "memorychip")),
                instruction: "В тестовой сборке используем один модуль в DDR4_1. Для двух модулей используйте DDR4_1 и DDR4_2. Совместите вырез с ключом слота.", manualPage: 10),
            AssemblyStep(id: "gpu", title: "Установить видеокарту",
                connector: BoardConnector(id: "pciex16", name: "PCIEX16",
                    component: PCComponent(id: "gpu", name: "Видеокарта", symbol: "pc")),
                instruction: "Для одной видеокарты используйте PCIEX16. Закрепите карту в корпусе; дополнительное питание проверяйте по её инструкции.", manualPage: 10),
            AssemblyStep(id: "sata", title: "Подключить накопитель",
                connector: BoardConnector(id: "sata3-0", name: "SATA3 0",
                    component: PCComponent(id: "ssd", name: "SATA-накопитель", symbol: "internaldrive")),
                instruction: "Соедините накопитель с SATA3 0 кабелем данных. Накопителю также требуется отдельное питание от блока питания.", manualPage: 15),
            AssemblyStep(id: "atx", title: "Подключить питание платы",
                connector: BoardConnector(id: "atx", name: "ATX",
                    component: PCComponent(id: "psu-atx", name: "Кабель ATX 24-pin", symbol: "bolt")),
                instruction: "Подключите основной 24-контактный кабель питания к ATX, совместив ключи и защёлку.", manualPage: 13),
            AssemblyStep(id: "cpu-power", title: "Подключить питание процессора",
                connector: BoardConnector(id: "cpu-power", name: "ATX_12V",
                    component: PCComponent(id: "psu-cpu", name: "Кабель CPU / EPS 8-pin", symbol: "bolt")),
                instruction: "Подключите кабель CPU / EPS к ATX_12V. Кабель PCIe для видеокарты сюда не подходит.", manualPage: 13)
        ])
}
