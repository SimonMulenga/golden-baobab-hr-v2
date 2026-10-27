import type { Branch, Company, Organization } from './types'

export const provinces = ['Central', 'Copperbelt', 'Eastern', 'Luapula', 'Lusaka', 'Muchinga', 'Northern', 'North-Western', 'Southern', 'Western']
export const industries = ['Agriculture', 'Construction', 'Education', 'Energy', 'Financial Services', 'Food & Beverage', 'Healthcare', 'Hospitality', 'Manufacturing', 'Mining', 'Retail', 'Technology', 'Transport & Logistics', 'Other']

const miningBranches: Branch[] = [
  { id: 'br-kitwe', name: 'Kitwe Central', code: 'KTC-01', province: 'Copperbelt', town: 'Kitwe', address: 'Plot 18, Freedom Avenue', manager: 'Mwamba Kunda', phone: '+260 212 222 410', status: 'Active', employeeCount: 126 },
  { id: 'br-chingola', name: 'Chingola Site', code: 'CHG-02', province: 'Copperbelt', town: 'Chingola', address: 'Mines Road, Industrial Area', manager: 'Chileshe Banda', phone: '+260 212 222 415', status: 'Active', employeeCount: 158 },
]
const foodsBranches: Branch[] = [
  { id: 'br-lsk', name: 'Lusaka Headquarters', code: 'LSK-01', province: 'Lusaka', town: 'Lusaka', address: 'Plot 42, Manda Hill Road', manager: 'Ruth Zulu', phone: '+260 211 350 220', status: 'Active', employeeCount: 98 },
  { id: 'br-kabwe', name: 'Kabwe Factory', code: 'KAB-02', province: 'Central', town: 'Kabwe', address: 'Great North Road, Industrial Area', manager: 'Leya Phiri', phone: '+260 215 350 225', status: 'Active', employeeCount: 98 },
]
const logisticsBranches: Branch[] = [
  { id: 'br-ndola', name: 'Ndola Depot', code: 'NDO-01', province: 'Copperbelt', town: 'Ndola', address: 'Plot 77, Kansenshi Road', manager: 'Joseph Mumba', phone: '+260 212 611 330', status: 'Active', employeeCount: 74 },
  { id: 'br-livingstone', name: 'Livingstone Hub', code: 'LVI-02', province: 'Southern', town: 'Livingstone', address: 'T1 Road, Industrial Area', manager: 'Tendai Chola', phone: '+260 213 611 335', status: 'Active', employeeCount: 68 },
]

export const mockCompanies: Company[] = [
  { id: 'co-copperbelt', name: 'Copperbelt Mining Co.', registrationNumber: '120180004327', tpin: '1008234567', industry: 'Mining', email: 'people@copperbelt.example', phone: '+260 212 222 400', address: 'Plot 18, Freedom Avenue', province: 'Copperbelt', town: 'Kitwe', logo: 'CM', contactPerson: 'Mwamba Kunda', status: 'Active', organizationId: 'org-mukuba', employeeCount: 284, createdAt: '2024-03-12', branches: miningBranches },
  { id: 'co-lusaka-foods', name: 'Lusaka Foods Ltd.', registrationNumber: '120190008612', tpin: '1012456789', industry: 'Food & Beverage', email: 'hr@lusakafoods.example', phone: '+260 211 350 200', address: 'Plot 42, Manda Hill Road', province: 'Lusaka', town: 'Lusaka', logo: 'LF', contactPerson: 'Ruth Zulu', status: 'Active', organizationId: 'org-lusaka-group', employeeCount: 196, createdAt: '2023-09-04', branches: foodsBranches },
  { id: 'co-zambezi', name: 'Zambezi Logistics', registrationNumber: '120210003981', tpin: '1020012345', industry: 'Transport & Logistics', email: 'office@zambezi.example', phone: '+260 212 611 300', address: 'Plot 77, Kansenshi Road', province: 'Copperbelt', town: 'Ndola', logo: 'ZL', contactPerson: 'Joseph Mumba', status: 'Active', organizationId: 'org-zambezi', employeeCount: 142, createdAt: '2022-06-20', branches: logisticsBranches },
  { id: 'co-mukuba-farms', name: 'Mukuba Farms', registrationNumber: '120200001576', tpin: '1010098765', industry: 'Agriculture', email: 'admin@mukubafarms.example', phone: '+260 212 455 210', address: 'Farm Block 12, Great North Road', province: 'Central', town: 'Kabwe', logo: 'MF', contactPerson: 'Leya Phiri', status: 'Active', organizationId: 'org-mukuba', employeeCount: 104, createdAt: '2022-01-15', branches: [{ id: 'br-kabwe-farm', name: 'Kabwe Farm', code: 'KBF-01', province: 'Central', town: 'Kabwe', address: 'Farm Block 12', manager: 'Leya Phiri', phone: '+260 215 455 215', status: 'Active', employeeCount: 104 }] },
  { id: 'co-baobab-energy', name: 'Baobab Energy Ltd.', registrationNumber: '120220009854', tpin: '1021198765', industry: 'Energy', email: 'people@baobabenergy.example', phone: '+260 211 770 180', address: 'Plot 9, Great East Road', province: 'Lusaka', town: 'Lusaka', logo: 'BE', contactPerson: 'Chola Mwansa', status: 'Active', organizationId: 'org-lusaka-group', employeeCount: 72, createdAt: '2023-05-08', branches: [{ id: 'br-lsk-energy', name: 'Lusaka Operations', code: 'LSO-01', province: 'Lusaka', town: 'Lusaka', address: 'Plot 9, Great East Road', manager: 'Chola Mwansa', phone: '+260 211 770 185', status: 'Active', employeeCount: 72 }] },
  { id: 'co-kafue-retail', name: 'Kafue Retail Group', registrationNumber: '120230006428', tpin: '1025634098', industry: 'Retail', email: 'team@kafueretail.example', phone: '+260 211 505 120', address: 'Plot 6, Independence Avenue', province: 'Southern', town: 'Choma', logo: 'KR', contactPerson: 'Tendai Chola', status: 'Pending', organizationId: 'org-zambezi', employeeCount: 40, createdAt: '2024-02-28', branches: [{ id: 'br-choma', name: 'Choma Market', code: 'CHM-01', province: 'Southern', town: 'Choma', address: 'Plot 6, Independence Avenue', manager: 'Tendai Chola', phone: '+260 213 505 125', status: 'Active', employeeCount: 40 }] },
]

export const mockOrganizations: Organization[] = [
  { id: 'org-mukuba', name: 'Mukuba Holdings', industry: 'Mining & Agriculture', description: 'A diversified Zambian business group with operations in the Copperbelt and Central Province.', status: 'Active', companyIds: ['co-copperbelt', 'co-mukuba-farms'] },
  { id: 'org-lusaka-group', name: 'Lusaka Foods Group', industry: 'Consumer & Energy', description: 'A growing group focused on essential goods and energy services.', status: 'Active', companyIds: ['co-lusaka-foods', 'co-baobab-energy'] },
  { id: 'org-zambezi', name: 'Zambezi Ventures', industry: 'Transport & Retail', description: 'A regional transport and retail group serving customers across Zambia.', status: 'Active', companyIds: ['co-zambezi', 'co-kafue-retail'] },
]
