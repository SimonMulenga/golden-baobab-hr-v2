import type { Employee } from './types'

const people = [
  ['Mwamba', 'Kunda', 'Finance', 'Finance Manager', 'co-copperbelt', 'br-kitwe', 14500],
  ['Chileshe', 'Banda', 'Operations', 'Site Supervisor', 'co-copperbelt', 'br-chingola', 9800],
  ['Precious', 'Nasilele', 'People & Culture', 'HR Officer', 'co-lusaka-foods', 'br-lsk', 11200],
  ['Joseph', 'Mumba', 'Operations', 'Fleet Coordinator', 'co-zambezi', 'br-ndola', 8600],
  ['Leya', 'Phiri', 'Agriculture', 'Farm Manager', 'co-mukuba-farms', 'br-kabwe-farm', 10500],
  ['Tendai', 'Chola', 'Sales', 'Regional Sales Lead', 'co-kafue-retail', 'br-choma', 9200],
  ['Bwalya', 'Tembo', 'Production', 'Production Lead', 'co-lusaka-foods', 'br-kabwe', 11800],
  ['Chola', 'Mwansa', 'Administration', 'Company Administrator', 'co-baobab-energy', 'br-lsk-energy', 16500],
  ['Martha', 'Zimba', 'Engineering', 'Electrical Engineer', 'co-copperbelt', 'br-kitwe', 13200],
  ['Kelvin', 'Sakala', 'Logistics', 'Dispatch Officer', 'co-zambezi', 'br-livingstone', 7900],
]
const firstNames = ['Misozi', 'Natasha', 'Patrick', 'Chimwemwe', 'Mapalo', 'Bupe', 'Chanda', 'Mwelwa', 'Luse', 'Mwila', 'Namukolo', 'Twaambo', 'Lombe', 'Kabwe', 'Mulenga', 'Tandiwe', 'Benson', 'Mwape', 'Chibwe', 'Thandi']
const surnames = ['Mwanza', 'Zulu', 'Phiri', 'Banda', 'Mumba', 'Tembo', 'Chileshe', 'Kabwe', 'Sakala', 'Bwalya', 'Nkhoma', 'Chanda', 'Mulenga', 'Lungu', 'Sinkala']

export const mockEmployees: Employee[] = Array.from({ length: 120 }, (_, index) => {
  const seed = people[index % people.length]
  const firstName = index < people.length ? seed[0] as string : firstNames[(index * 7) % firstNames.length]
  const lastName = index < people.length ? seed[1] as string : surnames[(index * 11) % surnames.length]
  const companyId = seed[4] as string
  const branchId = seed[5] as string
  const status: Employee['status'] = index % 19 === 0 ? 'On leave' : index % 17 === 0 ? 'Probation' : index % 29 === 0 ? 'Inactive' : 'Active'
  return {
    id: `emp-${String(index + 1).padStart(4, '0')}`,
    employeeNumber: `GB-${String(2601 + index).padStart(5, '0')}`,
    firstName,
    middleName: index % 4 === 0 ? 'Mwila' : '',
    lastName,
    dateOfBirth: `19${78 + (index % 20)}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
    gender: index % 2 === 0 ? 'Female' : 'Male',
    nationality: 'Zambian',
    idReference: `DEMO-NRC-${String(index + 1).padStart(6, '0')}`,
    phone: `+260 97 ${String(1000000 + index * 7919).slice(0, 3)} ${String(1000000 + index * 7919).slice(3)}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@example.test`,
    address: `${10 + index} Demo Road, ${seed[4] === 'co-copperbelt' ? 'Kitwe' : seed[4] === 'co-zambezi' ? 'Ndola' : 'Lusaka'}`,
    companyId,
    branchId,
    department: seed[2] as string,
    jobTitle: seed[3] as string,
    employmentType: index % 5 === 0 ? 'Fixed term' : 'Permanent',
    startDate: `202${index % 6}-${String((index % 12) + 1).padStart(2, '0')}-01`,
    contractEndDate: '',
    status,
    manager: ['Chola Mwansa', 'Mwamba Kunda', 'Ruth Zulu', 'Joseph Mumba'][index % 4],
    basicSalary: (seed[6] as number) + (Math.floor(index / 10) % 5) * 250,
    salaryFrequency: 'Monthly',
    paymentMethod: 'Bank transfer',
    bankName: ['Zanaco', 'ABSA Zambia', 'Stanbic Bank Zambia'][index % 3],
    accountName: `${firstName} ${lastName}`,
    accountNumber: `0000${String(84000000 + index * 281).slice(-8)}`,
    tpin: `10${String(10000000 + index * 381).slice(0, 8)}`,
    napsaReference: `NAPSA-DEMO-${String(index + 1).padStart(6, '0')}`,
    nhimaReference: `NHIMA-DEMO-${String(index + 1).padStart(6, '0')}`,
  }
})

export const departments = ['Administration', 'Agriculture', 'Engineering', 'Finance', 'Human Resources', 'Logistics', 'Operations', 'People & Culture', 'Production', 'Sales']
export const jobRoles = ['HR Officer', 'Payroll Officer', 'Finance Manager', 'Branch Manager', 'Operations Lead', 'Accountant', 'Engineer', 'Sales Representative', 'Production Lead', 'Driver']
